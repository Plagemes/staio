"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { isAiError } from "@/core/ai";
import {
  checkIdeas,
  expiringText,
  type CheckedIdea,
  type CheckedIngredient,
  type CheckedPantryRef,
  type IdeaCriteria,
  type IngredientStatus,
} from "@/core/ai/recipeIdeasCheck";
import { ALLERGEN_CHECK_NOTICE, type ConfirmationMap, type ItemSubject } from "@/core/allergens";
import { isStoredProduct } from "@/core/catalog";
import { activeLots } from "@/core/ledger";
import { totalMinutes } from "@/core/recipes";
import { formatQuantity } from "@/core/units";
import { appendEvents, getDeviceId, getProductRecord, usePantry, usePlan } from "@/data";
import { Button, SectionHeader } from "@/design";
import { dayOf } from "../format";
import { describeAiError } from "../ai/messages";
import { NotReady } from "../ai/NotReady";
import { PROVIDER_LABELS } from "../ai/providers/types";
import { activeModel, configIssue, dexieSettingsStore, type AiSettings } from "../ai/settings";
import { useAiSettings } from "../ai/useAiSettings";
import { evaluateLots } from "../lots";
import { useNotice } from "../notice";
import { fold, formatMinutes, formatServings, ingredientLine, splitList } from "../recipes/common";
import { useRecipePrefs, type RecipePrefs } from "../recipes/prefs";
import recipeStyles from "../recipes/recipes.module.css";
import { CONFIRMATION_NOTICE } from "../recipes/SafetyPanel";
import { confirmButtonText, confirmedText } from "../recipes/safety";
import { useConfirmationActions, useConfirmations } from "../recipes/useConfirmations";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { ReadInfo, SendNotice } from "./AiNotices";
import styles from "./AiCapture.module.css";
import { AiHead } from "./MealDraftReview";
import { recipeEventFromIdea } from "./ideaRecipe";
import { toPantryTarget, type PantryTarget } from "./pantryRefs";
import { readRecipeIdeas, type IdeasOutcome } from "./reads";

const TITLE = "Idee di ricette";
const TIME_OPTIONS = [0, 15, 30, 45, 60, 90];
const HONEST_LINE =
  "Sono proposte generate da un modello: leggile con giudizio, soprattutto per cotture e conservazione (carne, pesce, uova, avanzi). Le controlli tu prima di cucinarle.";

export function RecipeIdeas() {
  const { settings, ready } = useAiSettings();
  if (!ready) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>{TITLE}</h1>
        <p className={ui.lead} role="status">
          Un attimo…
        </p>
      </div>
    );
  }
  const issue = configIssue(settings);
  if (issue !== null) {
    return <NotReady issue={issue} title={TITLE} what="avere idee di ricette con ciò che hai in casa" alternative={{ href: "/app/ricette", label: "Vai al ricettario" }} />;
  }
  return <Loader settings={settings} />;
}

/** Gli alimenti mandati al modello con, se il codice a barre è noto, il nome del prodotto e gli allergeni in etichetta. */
async function withProductLabels(target: PantryTarget): Promise<CheckedPantryRef[]> {
  return Promise.all(
    target.refs.map(async (ref): Promise<CheckedPantryRef> => {
      const barcode = target.lotsById.get(ref.id)?.barcode;
      if (!barcode) return ref;
      const record = await getProductRecord(barcode).catch(() => undefined);
      const product = record && isStoredProduct(record.data) ? record.data : undefined;
      if (!product) return { ...ref, barcode };
      return {
        ...ref,
        barcode,
        ...(product.name ? { productName: product.name } : {}),
        ...(product.allergens && product.allergens.length > 0 ? { allergens: product.allergens } : {}),
      };
    }),
  );
}

/** Ricontrolla le idee con le etichette dei prodotti: può solo scartarne altre o renderle incerte, mai il contrario. */
function recheckWithLabels(out: IdeasOutcome, criteria: IdeaCriteria, labelled: readonly CheckedPantryRef[]): IdeasOutcome {
  if (!labelled.some((r) => r.productName !== undefined || r.allergens !== undefined)) return out;
  const ideas = [...out.accepted.map((a) => a.idea), ...out.rejected.map((r) => r.idea)];
  const again = checkIdeas(ideas, criteria, labelled);
  const before = new Map(out.rejected.map((r) => [r.idea, r]));
  // le idee già scartate restano scartate con i loro motivi
  const rejected = [...out.rejected, ...again.rejected.filter((r) => !before.has(r.idea))];
  const accepted = again.accepted.filter((a) => !before.has(a.idea));
  return { ...out, accepted, rejected };
}

/**
 * Rifà il controllo delle idee con le conferme di adesso: una conferma data (o revocata) dopo la risposta del modello cambia
 * l'esito subito. Le idee già scartate restano scartate: una conferma non vale mai per un allergene trovato.
 */
function recheckWithConfirmations(out: IdeasOutcome, criteria: IdeaCriteria, pantry: readonly CheckedPantryRef[]): IdeasOutcome {
  const ideas = [...out.accepted.map((a) => a.idea), ...out.rejected.map((r) => r.idea)];
  const again = checkIdeas(ideas, criteria, pantry);
  const before = new Set(out.rejected.map((r) => r.idea));
  return { ...out, accepted: again.accepted.filter((a) => !before.has(a.idea)), rejected: out.rejected };
}

/** Unione senza doppioni (a meno di maiuscole e accenti) di ciò che il ricettario e il piano dichiarano. */
function union(...lists: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const item of list) {
      const text = item.trim();
      const key = fold(text);
      if (text === "" || seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
  }
  return out;
}

function Loader({ settings }: { settings: AiSettings }) {
  const now = useNow();
  const pantry = usePantry();
  const plan = usePlan();
  const { prefs, ready } = useRecipePrefs();
  const { byKey: confirmations } = useConfirmations();
  if (pantry.error || plan.error) return <StorageError />;
  if (!pantry.data || !plan.data || !ready || !now || !confirmations) {
    return (
      <div className={ui.screen}>
        <AiHead title={TITLE} />
        <LoadingLine />
      </div>
    );
  }
  return (
    <Ideas
      settings={settings}
      now={now}
      prefs={prefs}
      planAllergens={plan.data.structure?.allergens ?? []}
      planExcluded={plan.data.structure?.excludedFoods ?? []}
      lots={activeLots(pantry.data)}
      confirmations={confirmations}
    />
  );
}

function Ideas({
  settings,
  now,
  prefs,
  planAllergens,
  planExcluded,
  lots,
  confirmations,
}: {
  settings: AiSettings;
  now: string;
  prefs: RecipePrefs;
  planAllergens: readonly string[];
  planExcluded: readonly string[];
  lots: ReturnType<typeof activeLots>;
  confirmations: ConfirmationMap;
}) {
  const ids = useId();
  const router = useRouter();
  const notice = useNotice();
  const actions = useConfirmationActions();
  const abortRef = useRef<AbortController | null>(null);

  const allergens = useMemo(() => union(prefs.allergens, planAllergens), [prefs.allergens, planAllergens]);
  const excluded = useMemo(() => union(prefs.excludedFoods, planExcluded), [prefs.excludedFoods, planExcluded]);
  const entries = useMemo(() => evaluateLots(lots, now), [lots, now]);

  const [maxMinutes, setMaxMinutes] = useState(0);
  const [servings, setServings] = useState(2);
  const [equipmentText, setEquipmentText] = useState(prefs.ownedEquipment.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<{ outcome: IdeasOutcome; criteria: IdeaCriteria; pantry: readonly CheckedPantryRef[] } | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // le conferme di adesso, non quelle di quando è arrivata la risposta
  const outcome = useMemo(
    () => (asked ? recheckWithConfirmations(asked.outcome, { ...asked.criteria, confirmations }, asked.pantry) : null),
    [asked, confirmations],
  );

  const model = activeModel(settings);
  const equipment = splitList(equipmentText, 20);
  const emptyPantry = entries.length === 0;

  async function onAsk() {
    if (busy || emptyPantry) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setAsked(null);
    setConfirmError(null);
    setSaved({});
    setSaveError(null);
    try {
      const target = toPantryTarget(entries);
      const criteria: IdeaCriteria = { allergens, excludedFoods: excluded, ...(maxMinutes > 0 ? { maxMinutes } : {}), ownedEquipment: equipment, confirmations };
      const out = await readRecipeIdeas({
        store: dexieSettingsStore(),
        target,
        criteria,
        equipment,
        servings,
        today: dayOf(new Date().toISOString()),
        signal: controller.signal,
      });
      const labelled = await withProductLabels(target);
      setAsked({ outcome: recheckWithLabels(out, criteria, labelled), criteria, pantry: labelled });
    } catch (e) {
      setError(isAiError(e) ? describeAiError(e, { provider: settings.provider, model }) : "La richiesta non è riuscita. Riprova.");
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  async function onConfirm(subject: ItemSubject): Promise<void> {
    setConfirmError(await actions.confirm(subject, { allergens, excludedFoods: excluded }));
  }

  async function onSave(index: number, checked: CheckedIdea, thenCook: boolean, confirmedUncertain: boolean) {
    if (saving !== null || !outcome) return;
    setSaving(index);
    setSaveError(null);
    try {
      const existing = saved[index];
      let recipeId = existing;
      if (!recipeId) {
        const result = recipeEventFromIdea(
          checked,
          { provider: PROVIDER_LABELS[settings.provider], model: outcome.info.model },
          { now: new Date().toISOString(), deviceId: await getDeviceId() },
          { confirmedUncertain },
        );
        if (!result.ok) {
          setSaveError(result.error);
          return;
        }
        const written = await appendEvents([result.event]);
        if (written.added === 0 || written.rejected.length > 0) {
          setSaveError("Non sono riuscito a salvare. Riprova.");
          return;
        }
        recipeId = result.event.recipeId;
        notice.show({ message: `Salvata nel ricettario: «${checked.idea.title}», segnata come generata.`, undo: [result.event] });
        setSaved((s) => ({ ...s, [index]: result.event.recipeId }));
      }
      if (thenCook) router.push(`/app/ricette/cucina?id=${encodeURIComponent(recipeId)}&porzioni=${checked.idea.servings}`);
    } catch {
      setSaveError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className={ui.screen}>
      <AiHead title={TITLE} />
      <p className={ui.lead}>
        Con un tocco ti propongo tre ricette con ciò che hai in casa, dando la precedenza a ciò che scade prima. Gli allergeni e le esclusioni li ricontrollo io sulla risposta, non mi fido del modello.
      </p>
      <p className={ui.hint}>{HONEST_LINE}</p>

      <SendNotice settings={settings} sends="L'elenco della tua dispensa (nomi, quantità, giorni alla scadenza), i tuoi allergeni ed esclusioni, il tempo e l'attrezzatura" now={now} />

      <section className={ui.section}>
        <SectionHeader label="Cosa ricordo di te" />
        <p className={ui.paragraph}>
          <strong>Allergeni:</strong> {allergens.length > 0 ? allergens.join(", ") : "nessuno dichiarato"}.
        </p>
        <p className={ui.paragraph}>
          <strong>Alimenti esclusi:</strong> {excluded.length > 0 ? excluded.join(", ") : "nessuno dichiarato"}.
        </p>
        <p className={ui.hint}>
          Li cambi nel{" "}
          <Link href="/app/ricette" className={ui.textLink}>
            ricettario
          </Link>{" "}
          o negli{" "}
          <Link href="/app/piano/obiettivi" className={ui.textLink}>
            obiettivi del piano
          </Link>
          . {ALLERGEN_CHECK_NOTICE}
        </p>
      </section>

      <div className={styles.limits}>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-time`}>
            Tempo disponibile
          </label>
          <select id={`${ids}-time`} className={ui.input} value={maxMinutes} onChange={(e) => setMaxMinutes(Number(e.target.value))} disabled={busy}>
            {TIME_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "Nessun limite" : `Al massimo ${formatMinutes(m)}`}
              </option>
            ))}
          </select>
        </div>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-servings`}>
            Per quante porzioni
          </label>
          <select id={`${ids}-servings`} className={ui.input} value={servings} onChange={(e) => setServings(Number(e.target.value))} disabled={busy}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {formatServings(n)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-equipment`}>
          Attrezzatura <span className={ui.optional}>(separata da virgole)</span>
        </label>
        <input id={`${ids}-equipment`} className={ui.input} type="text" value={equipmentText} onChange={(e) => setEquipmentText(e.target.value)} disabled={busy} autoComplete="off" placeholder="forno, padella, frullatore" />
        <p className={ui.hint}>Se la lasci vuota uso solo fornelli, forno e pentole comuni.</p>
      </div>

      <div className={ui.row}>
        <Button onClick={onAsk} disabled={busy || emptyPantry}>
          {busy ? "Penso a tre ricette…" : outcome ? "Proponi altre tre ricette" : "Proponi tre ricette"}
        </Button>
        {busy ? (
          <Button variant="outline" onClick={() => abortRef.current?.abort()}>
            Annulla
          </Button>
        ) : null}
      </div>
      {emptyPantry ? <p className={ui.hint}>La dispensa è vuota: aggiungi qualche alimento e poi chiedimi le idee.</p> : null}
      {busy ? (
        <p className={ui.hint} role="status">
          Può volerci mezzo minuto.
        </p>
      ) : null}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}

      {outcome ? (
        <>
          <div className={ui.callout} role="note">
            <p className={ui.paragraph}>
              <strong>Idee, non ricette provate.</strong> {HONEST_LINE} Nulla è nel ricettario finché non lo salvi tu.
            </p>
            <ReadInfo info={outcome.info} problems={outcome.problems} />
          </div>

          {outcome.accepted.length === 0 ? (
            <div className={ui.empty}>
              <h2 className={ui.emptyTitle}>Nessuna ricetta utilizzabile</h2>
              <p className={ui.emptyText}>
                {outcome.rejected.length > 0 ? "Quelle proposte contenevano qualcosa che hai escluso (sotto trovi perché). Puoi chiedere altre idee." : "Dalla risposta non ho ricavato ricette leggibili. Riprova."}
              </p>
            </div>
          ) : (
            <section className={ui.section}>
              <SectionHeader label={`Proposte (${outcome.accepted.length})`} />
              <ul className={styles.cards}>
                {outcome.accepted.map((checked, index) => (
                  <IdeaCard
                    key={`${checked.idea.title}-${index}`}
                    checked={checked}
                    savedId={saved[index]}
                    busy={saving === index}
                    disabled={saving !== null}
                    onSave={(thenCook, confirmedUncertain) => onSave(index, checked, thenCook, confirmedUncertain)}
                    onConfirm={onConfirm}
                    allergens={allergens}
                  />
                ))}
              </ul>
              {confirmError ? (
                <p className={ui.error} role="alert">
                  {confirmError}
                </p>
              ) : null}
              {saveError ? (
                <p className={ui.error} role="alert">
                  {saveError}
                </p>
              ) : null}
            </section>
          )}

          {outcome.rejected.length > 0 ? (
            <section className={ui.section}>
              <SectionHeader label={`Scartate (${outcome.rejected.length})`} />
              <ul className={ui.bullets}>
                {outcome.rejected.map((r, i) => (
                  <li key={`${r.idea.title}-${i}`} className={ui.paragraph}>
                    <strong>{r.idea.title}</strong>: scartata perché {r.reasons.join("; ")}.
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      <Link href="/app/ricette" className={ui.textLink}>
        Torna al ricettario
      </Link>
    </div>
  );
}

const STATUS_TEXT: Record<IngredientStatus, string> = {
  in_pantry: "in casa",
  partial: "in casa, ma non basta",
  to_confirm: "da confermare",
  unquantified: "in casa, quantità da verificare",
  missing: "da comprare",
};

function statusClass(status: IngredientStatus): string {
  if (status === "in_pantry") return styles.have;
  if (status === "missing" || status === "partial") return styles.lack;
  return styles.check;
}

function IngredientItem({ item }: { item: CheckedIngredient }) {
  const extra =
    item.status === "partial" && item.shortfall
      ? ` (mancano ${formatQuantity(item.shortfall)})`
      : item.status === "to_confirm" && item.matched.length > 0
        ? ` (hai «${item.matched.map((m) => m.name).join("», «")}»)`
        : "";
  return (
    <li>
      {ingredientLine(item.ingredient)} <span className={statusClass(item.status)}>· {STATUS_TEXT[item.status]}{extra}</span>
    </li>
  );
}

function IdeaCard({
  checked,
  savedId,
  busy,
  disabled,
  onSave,
  onConfirm,
  allergens,
}: {
  checked: CheckedIdea;
  savedId: string | undefined;
  busy: boolean;
  disabled: boolean;
  onSave: (thenCook: boolean, confirmedUncertain: boolean) => void;
  /** Conferma un ingrediente, uno alla volta: «ho letto l'etichetta, per me va bene». */
  onConfirm: (subject: ItemSubject) => Promise<void>;
  /** Gli allergeni dichiarati adesso: sono quelli che la conferma copre. */
  allergens: readonly string[];
}) {
  const { idea } = checked;
  const confirmId = useId();
  const [confirmed, setConfirmed] = useState(false);
  const minutes = totalMinutes({ times: idea.times, steps: idea.steps });
  const uncertain = checked.uncertain.length > 0;
  // finché l'utente non conferma di aver letto le etichette, la ricetta incerta non si salva
  const blocked = uncertain && !confirmed;
  return (
    <li className={styles.card}>
      <h3 className={styles.cardTitle}>{idea.title}</h3>
      <p className={styles.cardMeta}>
        <span>{formatServings(idea.servings)}</span>
        {minutes !== undefined ? <span>circa {formatMinutes(minutes)}</span> : null}
        <span>generata</span>
        {uncertain ? <span className={styles.check}>allergeni da verificare</span> : null}
        {checked.confirmed.length > 0 ? <span className={recipeStyles.flagConfirmed}>ingredienti confermati da te</span> : null}
      </p>

      {uncertain ? (
        <div className={ui.calloutStrong} role="alert">
          <p className={ui.paragraph}>
            <strong>Da controllare prima di salvare.</strong> Dal nome non so se questi ingredienti contengono i tuoi allergeni:
          </p>
          <ul className={styles.list}>
            {checked.uncertain.map((u, i) => (
              <li key={i}>{u}.</li>
            ))}
          </ul>
          {checked.uncertainIngredients.length > 0 ? (
            <>
              <p className={ui.hint}>Se hai letto l&apos;etichetta e per te va bene, puoi confermare un ingrediente alla volta.</p>
              <ul className={styles.list}>
                {checked.uncertainIngredients.map((u) => (
                  <li key={u.name}>
                    <Button variant="outline" onClick={() => void onConfirm(u.subject)}>
                      {confirmButtonText(u.name, allergens)}
                    </Button>
                  </li>
                ))}
              </ul>
              <p className={ui.hint}>{CONFIRMATION_NOTICE}</p>
            </>
          ) : null}
          {savedId ? null : (
            <label className={ui.switch} htmlFor={confirmId}>
              <input id={confirmId} type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span className={ui.switchText}>Ho letto le etichette di questi ingredienti: non contengono i miei allergeni.</span>
            </label>
          )}
        </div>
      ) : null}

      {checked.confirmed.length > 0 ? (
        <div className={`${ui.callout} ${recipeStyles.safetyConfirmed}`} role="note">
          <p className={ui.paragraph}>
            <strong>Confermato da te.</strong> L&apos;app non ha verificato questi ingredienti: l&apos;hai dichiarato tu.
          </p>
          <ul className={styles.list}>
            {checked.confirmed.map((c) => (
              <li key={c.name}>
                «{c.name}»: {confirmedText(c.confirmedAt)} per {c.allergens.join(", ")}.
              </li>
            ))}
          </ul>
          <p className={ui.hint}>Puoi revocare le conferme in «Obiettivi» del piano, dove dichiari gli allergeni.</p>
        </div>
      ) : null}

      {checked.expiringUsed.length > 0 ? (
        <p className={ui.paragraph}>
          <strong>Usa ciò che scade:</strong> {checked.expiringUsed.map(expiringText).join(", ")}.
        </p>
      ) : null}
      <p className={ui.paragraph}>
        <strong>Dalla tua dispensa:</strong> {checked.usedFromPantry.length > 0 ? checked.usedFromPantry.map((p) => p.name).join(", ") : "niente di sicuro"}.
      </p>
      <p className={ui.paragraph}>
        <strong>Ti manca:</strong> {checked.missing.length > 0 ? checked.missing.map((m) => ingredientLine(m)).join(", ") : "niente"}.
      </p>

      {checked.warnings.length > 0 ? (
        <ul className={styles.list}>
          {checked.warnings.map((w, i) => (
            <li key={i} className={styles.check}>
              {w}
            </li>
          ))}
        </ul>
      ) : null}

      <details>
        <summary className={ui.fieldLabel}>Ingredienti e passi</summary>
        <ul className={styles.list}>
          {checked.ingredients.map((item, i) => (
            <IngredientItem key={i} item={item} />
          ))}
        </ul>
        <ol className={styles.list}>
          {idea.steps.map((s, i) => (
            <li key={i}>
              {s.text}
              {s.durationMinutes ? ` (${formatMinutes(s.durationMinutes)})` : ""}
            </li>
          ))}
        </ol>
        {idea.equipment.length > 0 ? <p className={ui.hint}>Attrezzatura: {idea.equipment.join(", ")}.</p> : null}
        {idea.notes ? <p className={ui.hint}>Dal modello, da verificare: {idea.notes}</p> : null}
      </details>

      {savedId ? (
        <div className={ui.row}>
          <p className={ui.hint} role="status">
            Salvata nel ricettario, segnata come generata.
          </p>
          <Button href={`/app/ricette/vedi?id=${encodeURIComponent(savedId)}`} variant="outline">
            Aprila
          </Button>
          <Button href={`/app/ricette/cucina?id=${encodeURIComponent(savedId)}&porzioni=${idea.servings}`}>Cucina ora</Button>
        </div>
      ) : (
        <div className={ui.row}>
          <Button onClick={() => onSave(false, confirmed)} disabled={disabled || blocked}>
            {busy ? "Salvo…" : "Salva nel ricettario"}
          </Button>
          <Button variant="outline" onClick={() => onSave(true, confirmed)} disabled={disabled || blocked}>
            Salva e cucina ora
          </Button>
          {blocked ? <p className={ui.hint}>Per salvarla conferma prima di aver controllato le etichette.</p> : null}
        </div>
      )}
    </li>
  );
}
