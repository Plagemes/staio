"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { createSupplement, getDay } from "@/core/diary";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import { useDiary } from "@/data";
import { Button, Label, Value } from "@/design";
import { dayOf, formatTime } from "../format";
import { DrinkPantrySuggestion, useDrinkSuggestion } from "./DrinkPantry";
import { DrinkEntries, DrinkPresetChips, useDrinkActions } from "./Drinks";
import { recentSupplementNames } from "../health";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { useRecord } from "../useRecord";
import styles from "./health.module.css";

export function SupplementsCard() {
  const diary = useDiary();
  const now = useNow();
  const { record, busy } = useRecord();
  const ids = useId();
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [error, setError] = useState<string | null>(null);

  const today = now ? dayOf(now) : null;
  const recent = useMemo(() => (diary.data && today ? recentSupplementNames(diary.data, today) : []), [diary.data, today]);
  if (!diary.data || !today) return null;
  const day = getDay(diary.data, today);

  async function add(supplementName: string, supplementDose?: string) {
    const trimmed = supplementName.trim();
    if (trimmed === "") {
      setError("Scrivi il nome dell'integratore.");
      return false;
    }
    setError(null);
    const result = await record(
      (o) => [createSupplement({ name: trimmed, dose: supplementDose?.trim() || undefined }, o)],
      `Segnato: ${trimmed}${supplementDose?.trim() ? ` (${supplementDose.trim()})` : ""}.`,
    );
    if (!result.ok) setError(result.error);
    return result.ok;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (await add(name, dose)) {
      setName("");
      setDose("");
    }
  }

  return (
    <div className={styles.card}>
      {recent.length > 0 ? (
        <div className={styles.group}>
          <Label>Presi di recente</Label>
          <div className={styles.buttons}>
            {recent.map((n) => (
              <button key={n} type="button" className={styles.chip} disabled={busy} onClick={() => void add(n)}>
                {n}
                <span className={styles.chipHint}>preso ora</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <form className={ui.form} onSubmit={onSubmit} noValidate>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-name`}>
            Integratore
          </label>
          <input
            id={`${ids}-name`}
            className={ui.input}
            type="text"
            autoComplete="off"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="Vitamina D"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ids}-error` : undefined}
          />
        </div>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-dose`}>
            Dose <span className={ui.optional}>(facoltativa)</span>
          </label>
          <input id={`${ids}-dose`} className={ui.input} type="text" autoComplete="off" value={dose} onChange={(e) => setDose(e.target.value)} placeholder="1 compressa" />
        </div>
        {error ? (
          <p className={ui.error} id={`${ids}-error`}>
            {error}
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="outline" disabled={busy}>
            Segna come preso
          </Button>
        </div>
      </form>

      {day && day.supplements.length > 0 ? (
        <ul className={styles.todayList}>
          {day.supplements.map((s) => (
            <li key={s.eventId}>
              {formatTime(s.at)} · {s.name}
              {s.dose ? `, ${s.dose}` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p className={ui.hint}>Nessun integratore segnato oggi.</p>
      )}
    </div>
  );
}

const readNumber = (text: string): number | undefined => {
  const t = text.trim().replace(",", ".");
  if (t === "" || !/^\d+(?:\.\d+)?$/.test(t)) return undefined;
  return Number(t);
};

export function DrinksCard() {
  const diary = useDiary();
  const now = useNow();
  const actions = useDrinkActions(diary.data?.timeZone ?? DEFAULT_TIME_ZONE);
  const suggestion = useDrinkSuggestion();
  const ids = useId();
  const [name, setName] = useState("");
  const [ml, setMl] = useState("");
  const [caffeine, setCaffeine] = useState("");
  const [alcohol, setAlcohol] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!diary.data || !now) return null;
  const today = dayOf(now, diary.data.timeZone);
  const day = getDay(diary.data, today);

  async function onCustom(event: FormEvent) {
    event.preventDefault();
    const volume = readNumber(ml);
    if (name.trim() === "") return setError("Scrivi che bevanda è.");
    if (volume === undefined || volume <= 0) return setError("Scrivi i millilitri, per esempio 250.");
    const caffeineMg = caffeine.trim() === "" ? undefined : readNumber(caffeine);
    const alcoholG = alcohol.trim() === "" ? undefined : readNumber(alcohol);
    if (caffeine.trim() !== "" && caffeineMg === undefined) return setError("La caffeina va scritta in milligrammi, solo il numero.");
    if (alcohol.trim() !== "" && alcoholG === undefined) return setError("L'alcol va scritto in grammi, solo il numero.");
    setError(null);
    const result = await actions.add({ name: name.trim(), ml: volume, caffeineMg, alcoholG }, "label");
    if (result.ok) {
      suggestion.offer(name, result.events);
      setName("");
      setMl("");
      setCaffeine("");
      setAlcohol("");
    } else setError(result.error);
  }

  return (
    <div className={styles.card}>
      <DrinkPresetChips actions={actions} onError={setError} onAdded={suggestion.offer} />
      <DrinkPantrySuggestion suggestion={suggestion.suggestion} timeZone={diary.data.timeZone ?? DEFAULT_TIME_ZONE} onDone={suggestion.dismiss} />
      <p className={ui.hint}>
        Caffeina, alcol ed energia delle scelte rapide sono valori tipici, non misure: valgono come stime. La bevanda compare in Oggi, nel momento
        a cui appartiene per orario.
      </p>

      <form className={ui.form} onSubmit={onCustom} noValidate>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-name`}>
            Un&apos;altra bevanda
          </label>
          <input id={`${ids}-name`} className={ui.input} type="text" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} placeholder="Caffè lungo" />
        </div>
        <div className={styles.twoCols}>
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-ml`}>
              Millilitri
            </label>
            <input id={`${ids}-ml`} className={ui.input} type="text" inputMode="decimal" autoComplete="off" value={ml} onChange={(e) => setMl(e.target.value)} placeholder="250" />
          </div>
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-caf`}>
              Caffeina, mg
            </label>
            <input id={`${ids}-caf`} className={ui.input} type="text" inputMode="decimal" autoComplete="off" value={caffeine} onChange={(e) => setCaffeine(e.target.value)} placeholder="80" />
          </div>
        </div>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-alc`}>
            Alcol, grammi <span className={ui.optional}>(facoltativo)</span>
          </label>
          <input id={`${ids}-alc`} className={ui.input} type="text" inputMode="decimal" autoComplete="off" value={alcohol} onChange={(e) => setAlcohol(e.target.value)} placeholder="13" />
        </div>
        {error ? (
          <p className={ui.error} role="alert">
            {error}
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="outline" disabled={actions.busy}>
            Segna bevanda
          </Button>
        </div>
      </form>

      {day && day.drinks.length > 0 ? (
        <div className={styles.group}>
          <Label>Segnato oggi</Label>
          <p className={ui.paragraph}>
            {day.caffeineMg > 0 ? (
              <>
                Caffeina <Value certainty={day.caffeineCertainty === "estimated" ? "estimated" : "measured"}>{day.caffeineMg} mg</Value>
                {day.alcoholG > 0 ? " · " : ""}
              </>
            ) : null}
            {day.alcoholG > 0 ? (
              <>
                Alcol <Value certainty={day.alcoholCertainty === "estimated" ? "estimated" : "measured"}>{day.alcoholG.toString().replace(".", ",")} g</Value>
              </>
            ) : null}
            {day.caffeineMg === 0 && day.alcoholG === 0 ? "Bevande senza caffeina né alcol." : ""}
          </p>
          <DrinkEntries drinks={[...day.drinks].reverse()} date={today} actions={actions} onError={setError} showCounts />
        </div>
      ) : (
        <p className={ui.hint}>Nessuna bevanda segnata oggi.</p>
      )}
    </div>
  );
}
