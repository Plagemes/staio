"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { MEAL_KINDS, type MealKind } from "@/core/diary";
import { resolveReferences } from "@/core/nutrition";
import { dayTypeOf, type PlanState } from "@/core/plan";
import { ALLERGEN_CHECK_NOTICE, allergenLabels, confirmationLapse } from "@/core/allergens";
import { ALLERGEN_STEMS } from "@/core/recipes";
import { getDeviceId, usePlan } from "@/data";
import { Button, Label, SectionHeader } from "@/design";
import { MEAL_KIND_LABELS } from "../meals";
import { NUTRIENT_INFO } from "../nutrition/labels";
import { toEngineProfile } from "../nutrition/profile";
import { useNutritionProfile, useReferences } from "../nutrition/useNutrition";
import { useRecipePrefs } from "../recipes/prefs";
import { confirmedText, unionDeclared } from "../recipes/safety";
import { CONFIRMATION_NOTICE } from "../recipes/SafetyPanel";
import { useConfirmationActions, useConfirmations } from "../recipes/useConfirmations";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { dayOf } from "../format";
import { buildClearTargets, buildStructure, buildTargets } from "./edit";
import { TARGET_NUTRIENTS, formFromTargets, referenceHint, targetsFromForm, type TargetForm } from "./targets";
import { useWriter } from "./useWriter";
import styles from "./plan.module.css";

export function Goals() {
  const plan = usePlan();
  const now = useNow();
  if (plan.error) return <StorageError />;
  if (!plan.data || !now) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Obiettivi e struttura</h1>
        <LoadingLine />
      </div>
    );
  }
  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Obiettivi e struttura</h1>
        <Label>Scelti da te</Label>
      </div>
      <p className={ui.lead}>
        Gli obiettivi sono quelli che scrivi tu, per ogni tipo di giornata: Staio non ne propone e non dà pareri medici. Servono a confrontare il piano con ciò che hai deciso.
      </p>
      <TargetsSection plan={plan.data} today={dayOf(now)} />
      <StructureSection key={plan.data.structure?.eventId ?? "none"} plan={plan.data} />
      <ConfirmationsSection plan={plan.data} />
      <Link href="/app/piano/verifica" className={ui.textLink}>
        Vai alla verifica del piano
      </Link>
    </div>
  );
}

function knownTypes(plan: PlanState): string[] {
  return [
    ...new Set([...plan.targets.map((t) => t.dayType), ...plan.dayTypes.map((d) => d.dayType), ...(plan.structure?.defaultDayType ? [plan.structure.defaultDayType] : [])]),
  ].sort();
}

function TargetsSection({ plan, today }: { plan: PlanState; today: string }) {
  const ids = useId();
  const types = knownTypes(plan);
  const [selected, setSelected] = useState<string>(types[0] ?? "__new");
  const [custom, setCustom] = useState("");
  const name = selected === "__new" ? custom.trim() : selected;
  return (
    <section className={ui.section} aria-labelledby={`${ids}-h`}>
      <div id={`${ids}-h`}>
        <SectionHeader label="Obiettivi per tipo di giornata" />
      </div>
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
          <p className={ui.hint}>Non c&apos;è ancora nessun tipo di giornata. Scrivine uno, per esempio «allenamento» o «riposo», poi assegnalo ai giorni nella settimana.</p>
        ) : null}
      </fieldset>
      {name !== "" ? <TargetsForm key={name} plan={plan} dayType={name} today={today} /> : null}
    </section>
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
      <p className={ui.hint}>Lascia vuoto ciò che non vuoi controllare. Scrivi un minimo, un massimo o tutti e due.</p>
      {ready && !profile ? (
        <p className={ui.hint}>
          Per vedere accanto ai campi i valori di riferimento per te, <Link href="/app/impostazioni/profilo">compila il profilo</Link>.
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
        I giorni con questo tipo, oggi: {plan.dayTypes.filter((d) => dayTypeOf(plan, d.date) === dayType).length} con una scelta esplicita
        {plan.structure?.defaultDayType === dayType ? ", più tutti quelli senza scelta (è il tipo predefinito)" : ""}.
      </p>
    </form>
  );
}

function StructureSection({ plan }: { plan: PlanState }) {
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
  const [excluded, setExcluded] = useState((s?.excludedFoods ?? []).join("\n"));
  const [allergens, setAllergens] = useState<Set<string>>(() => new Set(s?.allergens ?? []));
  const [defaultType, setDefaultType] = useState(s?.defaultDayType ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const types = knownTypes(plan);
  const allergenKeys = Object.keys(ALLERGEN_STEMS);
  // allergeni scritti in passato che l'elenco non conosce: restano visibili
  const extraAllergens = [...allergens].filter((a) => !allergenKeys.includes(a));

  async function save() {
    const failure = await write((ctx) =>
      buildStructure(
        {
          meals: MEAL_KINDS.filter((k) => meals[k].on).map((k) => ({ kind: k, ...(meals[k].time ? { time: meals[k].time } : {}) })),
          ...(from || to ? { eatingFrom: from, eatingTo: to } : {}),
          excludedFoods: excluded.split(/[\n,;]+/),
          allergens: [...allergens],
          ...(defaultType.trim() ? { defaultDayType: defaultType } : {}),
        },
        ctx,
      ),
    );
    setMessage(failure);
  }

  return (
    <section className={ui.section} aria-labelledby={`${ids}-h`}>
      <div id={`${ids}-h`}>
        <SectionHeader label="Struttura del piano" />
      </div>
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
          <p className={ui.hint}>Gli orari sono indicativi: servono a ordinare i pasti, non a controllarti.</p>
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

        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-exc`}>
            Alimenti esclusi <span className={ui.optional}>(uno per riga)</span>
          </label>
          <textarea id={`${ids}-exc`} className={ui.input} rows={3} value={excluded} onChange={(e) => setExcluded(e.target.value)} placeholder={"olive\ncoriandolo"} style={{ paddingBlock: "var(--space-5)" }} />
          <p className={ui.hint}>Il piano ti avvisa se un alimento escluso compare in un pasto, anche tra gli ingredienti di una ricetta.</p>
        </div>

        <fieldset className={ui.field}>
          <legend className={ui.fieldLabel}>Allergeni da evitare</legend>
          <div className={styles.checkGrid}>
            {[...allergenKeys, ...extraAllergens].map((a) => (
              <label key={a} className={styles.check}>
                <input
                  type="checkbox"
                  checked={allergens.has(a)}
                  onChange={(e) =>
                    setAllergens((set) => {
                      const next = new Set(set);
                      if (e.target.checked) next.add(a);
                      else next.delete(a);
                      return next;
                    })
                  }
                />
                {a}
              </label>
            ))}
          </div>
          <p className={ui.hint}>{ALLERGEN_CHECK_NOTICE}</p>
        </fieldset>

        {message ? (
          <p className={ui.error} role="alert">
            {message}
          </p>
        ) : null}
        <Button type="submit">Salva la struttura</Button>
      </form>
    </section>
  );
}

/** Un'etichetta breve per riconoscere un dispositivo: le prime cifre del suo identificativo. */
const shortDevice = (id: string): string => id.slice(0, 6);

/**
 * Gli ingredienti che hai confermato («ho letto l'etichetta, per me va bene»), con la data e gli allergeni coperti, e il
 * modo di revocare ogni conferma. Una conferma copre solo ciò che era dichiarato quando l'hai data.
 */
function ConfirmationsSection({ plan }: { plan: PlanState }) {
  const ids = useId();
  const { state } = useConfirmations();
  const actions = useConfirmationActions();
  const { prefs, ready } = useRecipePrefs();
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
  const declared = useMemo(
    () => ({
      allergens: unionDeclared(prefs.allergens, plan.structure?.allergens ?? []),
      excludedFoods: unionDeclared(prefs.excludedFoods, plan.structure?.excludedFoods ?? []),
    }),
    [prefs.allergens, prefs.excludedFoods, plan.structure],
  );
  const labels = useMemo(() => allergenLabels(declared.allergens), [declared.allergens]);

  async function revoke(key: string, name: string) {
    setBusy(key);
    setError(null);
    const failed = await actions.revoke(key, name);
    setBusy(null);
    if (failed) setError(failed);
  }

  return (
    <section className={ui.section} aria-labelledby={`${ids}-h`}>
      <div id={`${ids}-h`}>
        <SectionHeader label="Ingredienti che hai confermato" />
      </div>
      {!state || !ready ? (
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
                  Revoca la conferma di «{c.ingredient}»
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
    </section>
  );
}
