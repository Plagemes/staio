"use client";

import Link from "next/link";
import { useDeferredValue, useId, useMemo, useState } from "react";
import type { Location } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import { appendEvents, getDeviceId } from "@/data";
import { Button, Label, Value } from "@/design";
import { searchRecipes } from "@/models3d/catalog";
import { FOOD_CATEGORY_GROUPS, FOOD_CATEGORY_LABELS, LOCATION_LABELS, LOCATION_ORDER } from "../labels";
import { useNotice } from "../notice";
import { buildQuickEvents, overrideKey, parseQuickLines, type QuickOverrides, type QuickRow } from "../quickAdd";
import ui from "../ui.module.css";
import styles from "./QuickAdd.module.css";

const modelCategoryOf = (name: string): string | undefined =>
  name.trim().length >= 2 ? searchRecipes(name)[0]?.category : undefined;

export function QuickAdd() {
  const notice = useNotice();
  const ids = useId();
  const [text, setText] = useState("");
  const [overrides, setOverrides] = useState<Record<string, QuickOverrides>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deferred = useDeferredValue(text);
  const rows = useMemo(
    () => parseQuickLines(deferred, { modelCategoryOf, overrides: new Map(Object.entries(overrides)) }),
    [deferred, overrides],
  );
  const ready = rows.filter((r) => r.status === "ok");
  const toFix = rows.length - ready.length;

  function patch(row: QuickRow, change: QuickOverrides) {
    const key = overrideKey(row.index, row.line);
    setOverrides((o) => ({ ...o, [key]: { ...o[key], ...change } }));
  }

  async function save() {
    if (saving || ready.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      // si rilegge il testo di adesso, non quello rimandato dell'anteprima
      const current = parseQuickLines(text, { modelCategoryOf, overrides: new Map(Object.entries(overrides)) });
      const result = buildQuickEvents(current, { now: new Date().toISOString(), deviceId: await getDeviceId() });
      const written = await appendEvents(result.events);
      if (written.added === 0 || written.rejected.length > 0) {
        setError("Non sono riuscito a salvare tutto. Controlla le righe e riprova.");
        return;
      }
      // restano nella casella solo le righe non salvate, con le loro correzioni
      const savedIndexes = new Set(result.saved.map((r) => r.index));
      const remaining = current.filter((r) => !savedIndexes.has(r.index));
      const next: Record<string, QuickOverrides> = {};
      remaining.forEach((r, i) => {
        const old = overrides[overrideKey(r.index, r.line)];
        if (old) next[overrideKey(i, r.line)] = old;
      });
      setText(remaining.map((r) => r.line).join("\n"));
      setOverrides(next);
      const n = result.saved.length;
      const left = remaining.length;
      notice.show({
        message:
          `${n === 1 ? "Aggiunto 1 alimento" : `Aggiunti ${n} alimenti`} come già in casa.` +
          (left > 0 ? ` ${left === 1 ? "Una riga resta" : `${left} righe restano`} da sistemare.` : ""),
        undo: result.events,
      });
    } catch {
      setError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Ho già in casa</h1>
        <Label>Aggiunta rapida</Label>
      </div>
      <p className={ui.lead}>
        Scrivi un alimento per riga, con la quantità. Per esempio «latte 1 l», «6 uova» o «pasta 500 g, credenza». Sono
        cose che avevi già: le quantità valgono come stime e senza prezzo.
      </p>

      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-text`}>
          Alimenti, uno per riga
        </label>
        <textarea
          id={`${ids}-text`}
          className={`${ui.input} ${styles.textarea}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoCapitalize="sentences"
          spellCheck={false}
          placeholder={"latte 1 l\n6 uova\npasta 500 g, credenza"}
        />
      </div>

      {rows.length > 0 ? (
        <section aria-labelledby={`${ids}-preview`} className={ui.section}>
          <h2 id={`${ids}-preview`} className={ui.srOnly}>
            Come ho letto le righe
          </h2>
          <Label>Come ho letto le righe</Label>
          <ul className={styles.rows}>
            {rows.map((row) => (
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
                        <Value certainty="estimated">{row.quantity ? formatQuantity(row.quantity) : ""}</Value>
                      </span>
                    </div>
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

      <div className={ui.field}>
        <Button onClick={save} disabled={saving || ready.length === 0}>
          {saving
            ? "Salvo…"
            : ready.length === 0
              ? "Aggiungi alla dispensa"
              : ready.length === 1
                ? "Aggiungi 1 alimento"
                : `Aggiungi ${ready.length} alimenti`}
        </Button>
        {toFix > 0 ? (
          <p className={ui.hint} role="status">
            {toFix === 1 ? "1 riga non si può aggiungere" : `${toFix} righe non si possono aggiungere`}: restano qui da
            correggere.
          </p>
        ) : null}
      </div>

      <div className={ui.row}>
        <Link href="/app/cattura" className={ui.textLink}>
          Aggiungi un alimento con tutti i dettagli
        </Link>
        <Link href="/app/dispensa" className={ui.textLink}>
          Vai alla dispensa
        </Link>
      </div>
    </div>
  );
}
