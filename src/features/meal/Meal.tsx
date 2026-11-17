"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState, type FormEvent } from "react";
import type { MealKind } from "@/core/diary";
import { activeLots } from "@/core/ledger";
import { appendEvents, getDeviceId, usePantry } from "@/data";
import { Button, Label } from "@/design";
import type { AmountChoice } from "../actions";
import { evaluateLots } from "../lots";
import {
  MEAL_KIND_LABELS,
  MEAL_KIND_ORDER,
  buildMealEvents,
  defaultHabitTitle,
  suggestMealKind,
  type FreeItemInput,
  type MealErrors,
} from "../meals";
import { useNotice } from "../notice";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { formatQuantity } from "@/core/units";
import styles from "./Meal.module.css";

type Amount = "all" | "half" | "quarter" | "text";
interface Selection {
  amount: Amount;
  text: string;
}
interface FreeRow extends FreeItemInput {
  id: number;
}

const AMOUNT_LABELS: Record<Amount, string> = { all: "Tutto", half: "Metà", quarter: "Un quarto", text: "Scrivo io" };

function toChoice(s: Selection): AmountChoice {
  return s.amount === "text" ? { kind: "text", text: s.text } : { kind: s.amount };
}

export function Meal() {
  const pantry = usePantry();
  const now = useNow();
  const notice = useNotice();
  const router = useRouter();
  const search = useSearchParams();
  const ids = useId();

  const [kind, setKind] = useState<MealKind | null>(null);
  const [selected, setSelected] = useState<Record<string, Selection>>(() => {
    const lotId = search.get("lotto");
    return lotId ? { [lotId]: { amount: "all", text: "" } } : {};
  });
  const [filter, setFilter] = useState("");
  const [free, setFree] = useState<FreeRow[]>([]);
  const [nextId, setNextId] = useState(1);
  const [saveHabit, setSaveHabit] = useState(false);
  const [habitTitle, setHabitTitle] = useState<string | null>(null);
  const [errors, setErrors] = useState<MealErrors | null>(null);
  const [saving, setSaving] = useState(false);

  const entries = useMemo(
    () => (pantry.data && now ? evaluateLots(activeLots(pantry.data), now) : []),
    [pantry.data, now],
  );

  if (pantry.error) return <StorageError />;
  if (!pantry.data || !now) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Registra pasto</h1>
        <LoadingLine />
      </div>
    );
  }

  const effectiveKind = kind ?? suggestMealKind(now);
  const effectiveHabitTitle = habitTitle ?? defaultHabitTitle(effectiveKind);
  const q = filter.trim().toLowerCase();
  const shown = entries.filter((e) => q === "" || e.lot.productRef.toLowerCase().includes(q) || selected[e.lot.lotId] !== undefined);

  function toggle(lotId: string) {
    setSelected((s) => {
      const next = { ...s };
      if (next[lotId]) delete next[lotId];
      else next[lotId] = { amount: "all", text: "" };
      return next;
    });
    setErrors(null);
  }

  function patch(lotId: string, change: Partial<Selection>) {
    setSelected((s) => ({ ...s, [lotId]: { ...s[lotId], ...change } }));
    setErrors(null);
  }

  function patchFree(id: number, change: Partial<FreeItemInput>) {
    setFree((rows) => rows.map((r) => (r.id === id ? { ...r, ...change } : r)));
    setErrors(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const picks = entries
        .filter((e) => selected[e.lot.lotId] !== undefined)
        .map((e) => ({ lot: e.lot, choice: toChoice(selected[e.lot.lotId]) }));
      const result = buildMealEvents(
        {
          kind: effectiveKind,
          picks,
          freeItems: free,
          saveHabitAs: saveHabit ? effectiveHabitTitle : undefined,
        },
        { now: new Date().toISOString(), deviceId: await getDeviceId() },
      );
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      const written = await appendEvents(result.events);
      if (written.added === 0 || written.rejected.length > 0) {
        setErrors({ picks: {}, free: {}, general: "Non sono riuscito a salvare. Riprova." });
        return;
      }
      notice.show({ message: result.message, undo: result.events });
      router.push("/app");
    } catch {
      setErrors({ picks: {}, free: {}, general: "Non sono riuscito a salvare sul telefono. Riprova." });
    } finally {
      setSaving(false);
    }
  }

  const count = Object.keys(selected).length + free.filter((f) => f.name.trim() !== "" || f.quantityText.trim() !== "").length;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Registra pasto</h1>
        <Label>{MEAL_KIND_LABELS[effectiveKind]}</Label>
      </div>

      <form className={ui.form} onSubmit={onSubmit} noValidate>
        <fieldset className={ui.field}>
          <legend className={ui.fieldLabel}>Che pasto è</legend>
          <div className={ui.choices}>
            {MEAL_KIND_ORDER.map((k) => (
              <label key={k} className={ui.choice}>
                <input type="radio" name={`${ids}-kind`} value={k} checked={effectiveKind === k} onChange={() => setKind(k)} />
                <span>{MEAL_KIND_LABELS[k]}</span>
              </label>
            ))}
          </div>
          {kind === null ? <p className={ui.hint}>Proposto dall&apos;ora: cambialo se serve.</p> : null}
        </fieldset>

        <section className={ui.field} aria-labelledby={`${ids}-pantry`}>
          <h2 className={ui.fieldLabel} id={`${ids}-pantry`}>
            Dalla dispensa
          </h2>
          {entries.length === 0 ? (
            <EmptyState
              title="La dispensa è vuota"
              text="Gli alimenti che aggiungi li potrai scegliere qui e scalare dal pasto. Intanto puoi scrivere le voci a mano, sotto."
              actionLabel="Aggiungi un alimento"
            />
          ) : (
            <>
              {entries.length > 6 ? (
                <input
                  className={ui.input}
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Cerca in dispensa"
                  aria-label="Cerca in dispensa"
                  autoComplete="off"
                />
              ) : null}
              <ul className={styles.lots}>
                {shown.map((entry) => {
                  const { lot } = entry;
                  const sel = selected[lot.lotId];
                  const err = errors?.picks[lot.lotId];
                  return (
                    <li key={lot.lotId} className={styles.lot}>
                      <label className={styles.lotHead}>
                        <input type="checkbox" checked={sel !== undefined} onChange={() => toggle(lot.lotId)} />
                        <span className={styles.lotText}>
                          <span className={styles.lotName}>{lot.productRef}</span>
                          <span className={styles.lotDetail}>
                            Ne restano {formatQuantity({ value: lot.remaining, unit: lot.unit })}
                            {lot.remainingCertainty === "estimated" ? " (stima)" : ""}
                          </span>
                        </span>
                      </label>
                      {sel ? (
                        <div className={styles.amounts}>
                          <div className={ui.choices} role="radiogroup" aria-label={`Quanto di ${lot.productRef}`}>
                            {(Object.keys(AMOUNT_LABELS) as Amount[]).map((a) => (
                              <label key={a} className={ui.choice}>
                                <input
                                  type="radio"
                                  name={`${ids}-${lot.lotId}`}
                                  value={a}
                                  checked={sel.amount === a}
                                  onChange={() => patch(lot.lotId, { amount: a })}
                                />
                                <span>{AMOUNT_LABELS[a]}</span>
                              </label>
                            ))}
                          </div>
                          {sel.amount === "text" ? (
                            <input
                              className={ui.input}
                              type="text"
                              value={sel.text}
                              onChange={(e) => patch(lot.lotId, { text: e.target.value })}
                              autoComplete="off"
                              placeholder={lot.unit === "pz" ? "2" : lot.unit === "ml" ? "200 ml" : "80 g"}
                              aria-label={`Quantità di ${lot.productRef}`}
                              aria-invalid={err ? true : undefined}
                            />
                          ) : sel.amount !== "all" ? (
                            <p className={ui.hint}>Una frazione è a occhio: vale come stima.</p>
                          ) : null}
                          {err ? <p className={ui.error}>{err}</p> : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {shown.length === 0 ? <p className={ui.hint}>Niente con questo nome.</p> : null}
            </>
          )}
        </section>

        <section className={ui.field} aria-labelledby={`${ids}-free`}>
          <h2 className={ui.fieldLabel} id={`${ids}-free`}>
            Altre voci <span className={ui.optional}>(non in dispensa)</span>
          </h2>
          {free.map((row, index) => (
            <div key={row.id} className={styles.freeRow}>
              <div className={styles.freeFields}>
                <input
                  className={ui.input}
                  type="text"
                  value={row.name}
                  onChange={(e) => patchFree(row.id, { name: e.target.value })}
                  autoComplete="off"
                  placeholder="Caffè"
                  aria-label={`Nome della voce ${index + 1}`}
                />
                <input
                  className={ui.input}
                  type="text"
                  value={row.quantityText}
                  onChange={(e) => patchFree(row.id, { quantityText: e.target.value })}
                  autoComplete="off"
                  placeholder="30 ml"
                  aria-label={`Quantità della voce ${index + 1}`}
                />
              </div>
              <Button variant="text" onClick={() => setFree((rows) => rows.filter((r) => r.id !== row.id))}>
                Togli
              </Button>
              {errors?.free[index] ? <p className={ui.error}>{errors.free[index]}</p> : null}
            </div>
          ))}
          <div>
            <Button
              variant="outline"
              onClick={() => {
                setFree((rows) => [...rows, { id: nextId, name: "", quantityText: "" }]);
                setNextId((n) => n + 1);
              }}
            >
              Aggiungi una voce a mano
            </Button>
          </div>
          <p className={ui.hint}>Le voci a mano non scalano la dispensa e valgono sempre come stime.</p>
        </section>

        <div className={ui.field}>
          <label className={ui.switch}>
            <input type="checkbox" role="switch" checked={saveHabit} onChange={(e) => setSaveHabit(e.target.checked)} />
            <span className={ui.switchText}>
              Salvalo come pasto abituale
              <span className={ui.hint}>Lo ritrovi in Oggi all&apos;ora giusta, da registrare con un tocco.</span>
            </span>
          </label>
          {saveHabit ? (
            <>
              <label className={ui.fieldLabel} htmlFor={`${ids}-habit`}>
                Nome del pasto abituale
              </label>
              <input
                id={`${ids}-habit`}
                className={ui.input}
                type="text"
                value={effectiveHabitTitle}
                onChange={(e) => setHabitTitle(e.target.value)}
                autoComplete="off"
              />
            </>
          ) : null}
        </div>

        {errors?.general ? (
          <p className={ui.error} role="alert">
            {errors.general}
          </p>
        ) : null}

        <Button type="submit" disabled={saving}>
          {saving ? "Salvo…" : count > 0 ? `Registra ${MEAL_KIND_LABELS[effectiveKind].toLowerCase()} (${count})` : "Registra pasto"}
        </Button>
      </form>

      <Link href="/app" className={ui.textLink}>
        Torna a Oggi
      </Link>
    </div>
  );
}
