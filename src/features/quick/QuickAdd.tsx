"use client";

import { useDeferredValue, useId, useMemo, useRef, useState } from "react";
import { activeLots, type Location } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import { appendEvents, getDeviceId, usePantry } from "@/data";
import { Button, Label, Value } from "@/design";
import { searchRecipes } from "@/models3d/catalog";
import { ActionBar } from "../common";
import { FOOD_CATEGORY_GROUPS, FOOD_CATEGORY_LABELS, LOCATION_LABELS, LOCATION_ORDER } from "../labels";
import { getSetting, setSetting, useSetting } from "../localSettings";
import { ITEM_DEFAULTS_KEY, itemKey, readItemDefault, withItemDefault } from "../memory/itemDefaults";
import { useItemDefaults } from "../memory/useItemDefaults";
import { useNotice } from "../notice";
import {
  QUICK_MODE_KEY,
  buildQuickEvents,
  initialQuickMode,
  isQuickMode,
  overrideKey,
  parseQuickLines,
  quickAddedMessage,
  restoreRemembered,
  type QuickMode,
  type QuickOverrides,
  type QuickRow,
} from "../quickAdd";
import ui from "../ui.module.css";
import styles from "./QuickAdd.module.css";

const modelCategoryOf = (name: string): string | undefined =>
  name.trim().length >= 2 ? searchRecipes(name)[0]?.category : undefined;

const isStoredMode = (value: unknown): value is QuickMode | null => value === null || isQuickMode(value);

const MODES: readonly { value: QuickMode; label: string; hint: string }[] = [
  { value: "bought", label: "Appena comprati", hint: "Entrano come acquisti di oggi." },
  { value: "had", label: "Già in casa", hint: "Entrano come cose che avevi già: senza prezzo, quantità stimate." },
];

/** Prima le righe da correggere, poi le altre, ciascun gruppo nell'ordine scritto. */
const fixFirst = (rows: readonly QuickRow[]): QuickRow[] => [...rows].sort((a, b) => Number(a.status === "ok") - Number(b.status === "ok"));

export function QuickAdd() {
  const notice = useNotice();
  const ids = useId();
  const pantry = usePantry();
  const stored = useSetting(QUICK_MODE_KEY, isStoredMode, null);
  const { memory } = useItemDefaults();
  const savingRef = useRef(false);
  const [picked, setPicked] = useState<QuickMode | null>(null);
  const [text, setText] = useState("");
  const [overrides, setOverrides] = useState<Record<string, QuickOverrides>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // la scelta ricordata; la prima volta, quando si sa se la dispensa è vuota
  const known = stored.ready && (stored.value !== null || pantry.data !== undefined || pantry.error !== undefined);
  const mode: QuickMode | null =
    picked ?? (known ? initialQuickMode(stored.value, pantry.data ? activeLots(pantry.data).length === 0 : false) : null);

  const deferred = useDeferredValue(text);
  const rows = useMemo(
    () =>
      parseQuickLines(deferred, {
        modelCategoryOf,
        overrides: new Map(Object.entries(overrides)),
        remembered: (name) => readItemDefault(memory, name),
      }),
    [deferred, overrides, memory],
  );
  const shown = useMemo(() => fixFirst(rows), [rows]);
  const ready = rows.filter((r) => r.status === "ok");
  const toFix = rows.length - ready.length;

  function choose(next: QuickMode) {
    setPicked(next);
    void setSetting(QUICK_MODE_KEY, next).catch(() => undefined);
  }

  function patch(row: QuickRow, change: QuickOverrides) {
    const key = overrideKey(row.index, row.line);
    setOverrides((o) => ({ ...o, [key]: { ...o[key], ...change } }));
  }

  /** Ricorda luogo, categoria e quantità di ogni riga scritta; restituisce la memoria di prima (nulla se non si è scritto). */
  async function rememberRows(rows: readonly QuickRow[]): Promise<unknown> {
    try {
      const before = await getSetting(ITEM_DEFAULTS_KEY);
      const at = new Date().toISOString();
      const next = rows.reduce<unknown>(
        (m, r) => (r.name && r.quantity ? withItemDefault(m, { name: r.name, category: r.category, location: r.location, quantityText: formatQuantity(r.quantity) }, at) : m),
        before,
      );
      await setSetting(ITEM_DEFAULTS_KEY, next);
      return before ?? {};
    } catch {
      // la memoria è un aiuto: se non si scrive, il salvataggio dell'alimento resta valido
      return undefined;
    }
  }

  async function save() {
    if (savingRef.current || saving || ready.length === 0 || mode === null) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      // si rilegge il testo di adesso, non quello rimandato dell'anteprima
      const current = parseQuickLines(text, {
        modelCategoryOf,
        overrides: new Map(Object.entries(overrides)),
        remembered: (name) => readItemDefault(memory, name),
      });
      const result = buildQuickEvents(current, { now: new Date().toISOString(), deviceId: await getDeviceId() }, { alreadyHave: mode === "had" });
      if (result.events.length === 0) return;
      // una sola scrittura per tutte le righe: una riga in «Ultime azioni», un «Annulla»
      const written = await appendEvents(result.events);
      // ogni riga scritta ha un evento, nello stesso ordine: ciò che non è entrato resta nel campo
      const rejected = new Set(written.rejected.map((r) => r.index));
      const events = result.events.filter((_, i) => !rejected.has(i));
      const savedRows = result.saved.filter((_, i) => !rejected.has(i));
      if (written.added === 0 || events.length === 0) {
        setError("Non sono riuscito a salvare. Controlla le righe e riprova.");
        return;
      }
      const savedIndexes = new Set(savedRows.map((r) => r.index));
      const remaining = current.filter((r) => !savedIndexes.has(r.index));
      const next: Record<string, QuickOverrides> = {};
      remaining.forEach((r, i) => {
        const old = overrides[overrideKey(r.index, r.line)];
        if (old) next[overrideKey(i, r.line)] = old;
      });
      setText(remaining.map((r) => r.line).join("\n"));
      setOverrides(next);
      // la memoria per nome impara da ogni riga scritta; «Annulla» la rimette com'era per quei nomi
      const keys = savedRows.flatMap((r) => (r.name ? [itemKey(r.name)] : []));
      const before = await rememberRows(savedRows);
      notice.show({
        message: quickAddedMessage(savedRows.length, remaining),
        undo: events,
        onUndo: async () => {
          if (before === undefined) return;
          try {
            await setSetting(ITEM_DEFAULTS_KEY, restoreRemembered(await getSetting(ITEM_DEFAULTS_KEY), before, keys));
          } catch {
            // la memoria è un aiuto: gli alimenti si tolgono lo stesso
          }
        },
        link: { label: "Vedi", href: "/app/dispensa" },
      });
      void setSetting(QUICK_MODE_KEY, mode).catch(() => undefined);
    } catch {
      setError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const modeHint = MODES.find((m) => m.value === mode)?.hint;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Più alimenti</h1>
      </div>

      <fieldset className={ui.field}>
        <legend className={ui.srOnly}>Da dove vengono</legend>
        <div className={ui.choices}>
          {MODES.map((m) => (
            <label key={m.value} className={ui.choice}>
              <input type="radio" name={`${ids}-mode`} value={m.value} checked={mode === m.value} onChange={() => choose(m.value)} />
              <span>{m.label}</span>
            </label>
          ))}
        </div>
        {modeHint ? <p className={ui.hint}>{modeHint}</p> : null}
      </fieldset>

      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-text`}>
          Alimenti, uno per riga
        </label>
        <p className={ui.hint} id={`${ids}-text-hint`}>
          Un alimento per riga, con la quantità: “latte 1 l”, “6 uova”, “pasta 500 g, credenza”.
        </p>
        <textarea
          id={`${ids}-text`}
          className={`${ui.input} ${styles.textarea}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoCapitalize="sentences"
          spellCheck={false}
          aria-describedby={`${ids}-text-hint`}
          placeholder={"latte 1 l\n6 uova\npasta 500 g, credenza"}
        />
      </div>

      {rows.length > 0 ? (
        <section aria-labelledby={`${ids}-preview`} className={ui.section}>
          <h2 id={`${ids}-preview`} className={ui.srOnly}>
            Come ho letto le righe
          </h2>
          <Label>Come ho letto le righe</Label>
          {toFix > 0 ? (
            <p className={ui.hint} role="status">
              {toFix === 1 ? "1 riga non si può aggiungere" : `${toFix} righe non si possono aggiungere`}: restano nel campo da correggere.
            </p>
          ) : null}
          <ul className={styles.rows}>
            {shown.map((row) => (
              <li key={`${row.index}:${row.line}`} className={styles.row}>
                {row.status === "unreadable" ? (
                  <>
                    <p className={styles.line}>{row.line}</p>
                    <p className={ui.error}>Non letta. {row.error}</p>
                  </>
                ) : (
                  <>
                    <div className={styles.rowHead}>
                      <span className={styles.rowName}>{row.name}</span>
                      <span className={styles.rowQuantity}>
                        <Value certainty={mode === "bought" ? "label" : "estimated"}>{row.quantity ? formatQuantity(row.quantity) : ""}</Value>
                      </span>
                    </div>
                    {row.fromMemory ? <p className={ui.hint}>come l&apos;ultima volta</p> : null}
                    <div className={styles.pickers}>
                      <label>
                        <span className={ui.hint}>
                          Categoria{row.status === "ok" && !overrides[overrideKey(row.index, row.line)]?.category ? " (proposta)" : ""}
                        </span>
                        <select
                          className={ui.input}
                          value={row.category ?? ""}
                          aria-label={`Categoria di ${row.name}`}
                          aria-invalid={row.status === "needs_category" ? true : undefined}
                          onChange={(e) => patch(row, { category: e.target.value })}
                        >
                          <option value="">Scegli una categoria</option>
                          {FOOD_CATEGORY_GROUPS.map((g) => (
                            <optgroup key={g.label} label={g.label}>
                              {g.categories.map((c) => (
                                <option key={c} value={c}>
                                  {FOOD_CATEGORY_LABELS[c]}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className={ui.hint}>Dove sta{row.locationFromText ? "" : " (proposto)"}</span>
                        <select
                          className={ui.input}
                          value={row.location ?? "frigo"}
                          aria-label={`Luogo di ${row.name}`}
                          onChange={(e) => patch(row, { location: e.target.value as Location })}
                        >
                          {LOCATION_ORDER.map((l) => (
                            <option key={l} value={l}>
                              {LOCATION_LABELS[l]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {row.status === "needs_category" ? (
                      <p className={ui.error}>Non so che categoria sia: sceglila per poterlo aggiungere.</p>
                    ) : null}
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}

      <ActionBar>
        <Button onClick={() => void save()} disabled={saving || ready.length === 0 || mode === null}>
          {saving ? "Salvo…" : `Aggiungi alla dispensa (${ready.length})`}
        </Button>
      </ActionBar>
    </div>
  );
}
