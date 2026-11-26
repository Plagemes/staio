"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { MEAL_KINDS, type MealKind } from "@/core/diary";
import { resolveReferences } from "@/core/nutrition";
import { dayTypeOf, type PlanState } from "@/core/plan";
import { allergenLabels, confirmationLapse } from "@/core/allergens";
import { getDeviceId } from "@/data";
import { Button } from "@/design";
import { declaredForStructure, declaredLists, useDietDeclarations } from "../allergens";
import { MEAL_KIND_LABELS } from "../meals";
import { NUTRIENT_INFO } from "../nutrition/labels";
import { toEngineProfile } from "../nutrition/profile";
import { useNutritionProfile, useReferences } from "../nutrition/useNutrition";
import { confirmedText } from "../recipes/safety";
import { CONFIRMATION_NOTICE } from "../recipes/SafetyPanel";
import { useConfirmationActions, useConfirmations } from "../recipes/useConfirmations";
import { LoadingLine } from "../shell/EmptyState";
import { Disclosure } from "../common/Disclosure";
import ui from "../ui.module.css";
import { DietView } from "../settings/DietScreen";
import { buildClearTargets, buildStructure, buildTargets } from "./edit";
import { TARGET_NUTRIENTS, formFromTargets, referenceHint, targetsFromForm, type TargetForm } from "./targets";
import { useWriter } from "./useWriter";
import styles from "./plan.module.css";

/**
 * L'indirizzo di prima (`/app/piano/obiettivi`): la stessa schermata di Alimentazione, con «Obiettivi» aperto. Niente
 * reindirizzamento: la pagina resta statica e senza rete si apre com'era.
 */
export function Goals() {
  return <DietView initial="obiettivi" />;
}

function knownTypes(plan: PlanState): string[] {
  return [
    ...new Set([...plan.targets.map((t) => t.dayType), ...plan.dayTypes.map((d) => d.dayType), ...(plan.structure?.defaultDayType ? [plan.structure.defaultDayType] : [])]),
  ].sort();
}

/** I tipi di giornata che hanno degli obiettivi, in ordine alfabetico. */
export const typesWithTargets = (plan: PlanState): string[] => plan.targets.map((t) => t.dayType);

/** Dentro la riga «Obiettivi per tipo di giornata». */
export function TargetsSection({ plan, today }: { plan: PlanState; today: string }) {
  const ids = useId();
  const types = knownTypes(plan);
  const [selected, setSelected] = useState<string>(types[0] ?? "__new");
  const [custom, setCustom] = useState("");
  const name = selected === "__new" ? custom.trim() : selected;
  return (
    <>
      <fieldset className={ui.field}>
        <legend className={ui.srOnly}>Tipo di giornata</legend>
        <div className={ui.choices}>
          {types.map((t) => (
            <label key={t} className={ui.choice}>
              <input type="radio" name={`${ids}-type`} checked={selected === t} onChange={() => setSelected(t)} />
              <span>{t}</span>
            </label>
          ))}
          <label className={ui.choice}>
            <input type="radio" name={`${ids}-type`} checked={selected === "__new"} onChange={() => setSelected("__new")} />
            <span>Nuovo tipo</span>
          </label>
        </div>
        {selected === "__new" ? (
          <input className={ui.input} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="allenamento" aria-label="Nome del nuovo tipo di giornata" autoComplete="off" />
        ) : null}
        {types.length === 0 ? (
          <p className={ui.hint}>Nessun tipo di giornata: scrivine uno, per esempio «allenamento».</p>
        ) : null}
      </fieldset>
      {name !== "" ? <TargetsForm key={name} plan={plan} dayType={name} today={today} /> : null}
    </>
  );
}

function TargetsForm({ plan, dayType, today }: { plan: PlanState; dayType: string; today: string }) {
  const ids = useId();
  const write = useWriter();
  const existing = plan.targets.find((t) => t.dayType === dayType);
  const [form, setForm] = useState<TargetForm>(() => formFromTargets(existing?.targets));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const { profile, ready } = useNutritionProfile();
  const references = useReferences();
  const resolved = useMemo(() => (profile && references ? resolveReferences(references, toEngineProfile(profile, today)) : []), [profile, references, today]);

  function patch(key: string, side: "min" | "max", value: string) {
    setForm((f) => ({ ...f, [key]: { ...(f[key as keyof TargetForm] ?? { min: "", max: "" }), [side]: value } }));
    setErrors({});
    setGeneral(null);
  }

  async function save() {
    const r = targetsFromForm(form);
    if (!r.ok) return setErrors(r.errors);
    const failure = await write((ctx) => buildTargets(dayType, r.targets, ctx));
    setGeneral(failure);
  }

  return (
    <form
      className={ui.form}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      noValidate
    >
      <Disclosure quiet title="Che cosa significa">Gli obiettivi sono quelli che scrivi tu: non ne propongo. Lascia vuoto ciò che non vuoi controllare; scrivi un minimo, un massimo o tutti e due.</Disclosure>
      {ready && !profile ? (
        <p className={ui.hint}>
          Per i valori di riferimento <Link href="/app/impostazioni/profilo">compila il profilo</Link>.
        </p>
      ) : null}
      <div>
        {TARGET_NUTRIENTS.map((key) => {
          const info = NUTRIENT_INFO[key];
          const hint = referenceHint(resolved, key);
          const err = errors[key];
          return (
            <div key={key} className={styles.targetRow}>
              <span className={ui.fieldLabel}>
                {info.label} <span className={ui.optional}>({info.unit} al giorno)</span>
              </span>
              <div className={styles.twoCols}>
                <input
                  className={ui.input}
                  inputMode="decimal"
                  value={form[key]?.min ?? ""}
                  onChange={(e) => patch(key, "min", e.target.value)}
                  placeholder="minimo"
                  aria-label={`${info.label}, minimo`}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={`${ids}-${key}`}
                  autoComplete="off"
                />
                <input
                  className={ui.input}
                  inputMode="decimal"
                  value={form[key]?.max ?? ""}
                  onChange={(e) => patch(key, "max", e.target.value)}
                  placeholder="massimo"
                  aria-label={`${info.label}, massimo`}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={`${ids}-${key}`}
                  autoComplete="off"
                />
              </div>
              <div id={`${ids}-${key}`}>
                {hint ? <p className={ui.hint}>{hint}</p> : null}
                {err ? <p className={ui.error}>{err}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
      {general ? (
        <p className={ui.error} role="alert">
          {general}
        </p>
      ) : null}
      <div className={ui.row}>
        <Button type="submit">Salva gli obiettivi di «{dayType}»</Button>
        {existing ? (
          <Button
            variant="outline"
            onClick={async () => {
              setGeneral(await write((ctx) => buildClearTargets(existing.eventId, dayType, ctx)));
              setForm(formFromTargets(undefined));
            }}
          >
            Togli
          </Button>
        ) : null}
      </div>
      <p className={ui.hint}>
        Giorni con questo tipo: {plan.dayTypes.filter((d) => dayTypeOf(plan, d.date) === dayType).length} scelti da te
        {plan.structure?.defaultDayType === dayType ? ", più quelli senza scelta (predefinito)" : ""}.
      </p>
    </form>
  );
}

/** Dentro la riga «Pasti e orari». */
export function StructureSection({ plan }: { plan: PlanState }) {
  const ids = useId();
  const write = useWriter();
  const s = plan.structure;
  const [meals, setMeals] = useState<Record<MealKind, { on: boolean; time: string }>>(() => {
    const base = Object.fromEntries(MEAL_KINDS.map((k) => [k, { on: !s && k !== "snack", time: "" }])) as Record<MealKind, { on: boolean; time: string }>;
    for (const m of s?.meals ?? []) base[m.kind] = { on: true, time: m.time ?? "" };
    return base;
  });
  const [from, setFrom] = useState(s?.eatingWindow?.from ?? "");
  const [to, setTo] = useState(s?.eatingWindow?.to ?? "");
  const [defaultType, setDefaultType] = useState(s?.defaultDayType ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const types = knownTypes(plan);

  async function save() {
    // allergeni ed esclusioni si portano avanti come sono adesso (riletti), così i telefoni non aggiornati li vedono ancora
    let declared: { allergens: string[]; excludedFoods: string[] } | undefined;
    try {
      declared = await declaredForStructure();
    } catch {
      declared = undefined;
    }
    if (!declared) {
      setMessage("Non riesco a leggere tutti gli allergeni che hai indicato: la struttura non si salva, per non perderli. Riprova.");
      return;
    }
    const lists = declared;
    const failure = await write((ctx) =>
      buildStructure(
        {
          meals: MEAL_KINDS.filter((k) => meals[k].on).map((k) => ({ kind: k, ...(meals[k].time ? { time: meals[k].time } : {}) })),
          ...(from || to ? { eatingFrom: from, eatingTo: to } : {}),
          excludedFoods: lists.excludedFoods,
          allergens: lists.allergens,
          ...(defaultType.trim() ? { defaultDayType: defaultType } : {}),
        },
        ctx,
      ),
    );
    setMessage(failure);
  }

  return (
    <form
      className={ui.form}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      noValidate
    >
      <fieldset className={ui.field}>
        <legend className={ui.fieldLabel}>Quanti pasti, e a che ora circa</legend>
        {MEAL_KINDS.map((k) => (
          <div key={k} className={styles.twoCols}>
            <label className={styles.check}>
              <input type="checkbox" checked={meals[k].on} onChange={(e) => setMeals((m) => ({ ...m, [k]: { ...m[k], on: e.target.checked } }))} />
              {MEAL_KIND_LABELS[k]}
            </label>
            <input
              className={ui.input}
              type="time"
              value={meals[k].time}
              disabled={!meals[k].on}
              onChange={(e) => setMeals((m) => ({ ...m, [k]: { ...m[k], time: e.target.value } }))}
              aria-label={`Orario indicativo, ${MEAL_KIND_LABELS[k].toLowerCase()}`}
            />
          </div>
        ))}
        <Disclosure quiet title="Che cosa significa">Gli orari sono indicativi: servono a ordinare i pasti, non a controllarti.</Disclosure>
      </fieldset>

      <fieldset className={ui.field}>
        <legend className={ui.fieldLabel}>
          Finestra in cui mangi <span className={ui.optional}>(facoltativa)</span>
        </legend>
        <div className={styles.twoCols}>
          <input className={ui.input} type="time" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Dalle" />
          <input className={ui.input} type="time" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Alle" />
        </div>
      </fieldset>

      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-def`}>
          Tipo di giornata predefinito <span className={ui.optional}>(per i giorni senza una scelta)</span>
        </label>
        <input id={`${ids}-def`} className={ui.input} list={`${ids}-types`} value={defaultType} onChange={(e) => setDefaultType(e.target.value)} autoComplete="off" placeholder="riposo" />
        <datalist id={`${ids}-types`}>
          {types.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>

      {message ? (
        <p className={ui.error} role="alert">
          {message}
        </p>
      ) : null}
      <Button type="submit">Salva i pasti</Button>
    </form>
  );
}

/** Un'etichetta breve per riconoscere un dispositivo: le prime cifre del suo identificativo. */
const shortDevice = (id: string): string => id.slice(0, 6);

/**
 * Dentro la riga «Ingredienti che hai confermato» («ho letto l'etichetta, per me va bene»): ognuno con la data e gli
 * allergeni coperti, e il modo di togliere la conferma. Una conferma copre solo ciò che era dichiarato quando l'hai data.
 */
export function ConfirmationsSection() {
  const { state } = useConfirmations();
  const actions = useConfirmationActions();
  const diet = useDietDeclarations();
  const ready = diet.state !== undefined;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thisDevice, setThisDevice] = useState<string | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    getDeviceId().then(
      (id) => alive && setThisDevice(id),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  const declared = useMemo(() => (diet.state ? declaredLists(diet.state) : { allergens: [], excludedFoods: [] }), [diet.state]);
  const labels = useMemo(() => allergenLabels(declared.allergens), [declared.allergens]);

  async function revoke(key: string, name: string) {
    setBusy(key);
    setError(null);
    const failed = await actions.revoke(key, name);
    setBusy(null);
    if (failed) setError(failed);
  }

  return (
    <>
      {diet.error !== undefined ? (
        <p className={ui.error} role="alert">
          Non riesco a leggere le conferme. Chiudi e riapri l&apos;app.
        </p>
      ) : !state || !ready ? (
        <LoadingLine />
      ) : state.active.length === 0 ? (
        <p className={ui.paragraph}>
          Non hai confermato nessun ingrediente. Quando un ingrediente è «non verificabile», dalla scheda della ricetta puoi confermarlo, un ingrediente alla volta, dopo aver letto l&apos;etichetta.
        </p>
      ) : (
        <ul className={styles.rows}>
          {state.active.map((c) => {
            const lapse = confirmationLapse(c, labels, declared.excludedFoods);
            return (
              <li key={c.key} className={styles.row}>
                <strong>«{c.ingredient}»</strong>: {confirmedText(c.confirmedAt)}, per {c.allergens.join(", ")}.{" "}
                {thisDevice === undefined ? null : c.deviceId === thisDevice ? "Data su questo dispositivo." : `Data su un altro dispositivo (${shortDevice(c.deviceId)}).`}
                {lapse.excludedFoods.length > 0 ? (
                  <> Hai escluso dopo {lapse.excludedFoods.join(", ")}: la conferma non vale finché non la dai di nuovo.</>
                ) : lapse.allergens.length > 0 ? (
                  <> Non copre {lapse.allergens.join(", ")}, che hai dichiarato dopo: per quello l&apos;ingrediente torna da verificare.</>
                ) : null}{" "}
                <Button variant="text" disabled={busy !== null} onClick={() => void revoke(c.key, c.ingredient)}>
                  Togli la conferma di «{c.ingredient}»
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
      <p className={ui.hint}>{CONFIRMATION_NOTICE}</p>
    </>
  );
}
