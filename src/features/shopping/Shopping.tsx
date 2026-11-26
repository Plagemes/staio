"use client";

import Link from "next/link";
import { useId, useMemo, useRef, useState } from "react";
import { Button, SectionHeader, cx } from "@/design";
import { generateId } from "@/core/ledger";
import { monthlyBudgetProgress, spendRanges, summarizeSpend, type SpendPeriodId } from "@/core/prices";
import { emptyRejections, type RejectionMemory } from "@/core/shopping";
import { formatQuantity } from "@/core/units";
import { getSetting } from "@/data";
import { ActionBar, BreakdownSheet, Disclosure, MoreActions, type ActionItem } from "../common";
import { Hint } from "../common/Hint";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { Costs } from "./Costs";
import { shoppingCostContent, spendContent } from "./costBreakdown";
import { Prices } from "./Prices";
import { Spending } from "./Spending";
import { ItemSheet, type ItemActions, type SheetTarget } from "./ItemSheet";
import { coveredText } from "./planNeeds";
import { confirm, confirmAll, forgetRejections, reject, restore, setQuantity, unconfirm } from "./decisions";
import {
  addedText,
  barState,
  confirmedAllText,
  confirmedText,
  costsSummary,
  itemQuantityText,
  itemSubline,
  leftInField,
  notReadText,
  proposedAgainText,
  quantityChangedText,
  readEntries,
  removedText,
  toInputs,
  unconfirmedText,
} from "./listText";
import { baseQuantityOf, mergeManualItems, type ManualItem } from "./manual";
import { SETTING_KEYS, emptyDecisions, isDecisions, isManualList, isRejectionMemory, type Decisions } from "./settings";
import { useShoppingData, type ShoppingData } from "./useShoppingData";
import { useSettingsUndo } from "./useSettingsUndo";
import type { ViewItem } from "./view";
import styles from "./shopping.module.css";

type Undo = ReturnType<typeof useSettingsUndo>;

/** Un solo foglio alla volta: la voce o uno dei fogli «Da cosa è fatto» dei costi. */
type OpenSheet = { kind: "item"; id: string } | { kind: "cost" } | { kind: "spend"; period: SpendPeriodId };

export function Shopping() {
  const data = useShoppingData();
  const undo = useSettingsUndo(data.save);
  if (data.error) return <StorageError />;
  if (!data.ready || !data.view) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Lista della spesa</h1>
        <LoadingLine />
      </div>
    );
  }
  return <ShoppingView data={data} undo={undo} />;
}

/* Prima di scrivere, lo stato si rilegge dall'archivio: ciò che è a schermo può essere di un istante fa. */

async function readDecisions(): Promise<Decisions> {
  const stored = await getSetting<unknown>(SETTING_KEYS.decisions);
  return isDecisions(stored) ? stored : emptyDecisions();
}

async function readRejections(): Promise<RejectionMemory> {
  const stored = await getSetting<unknown>(SETTING_KEYS.rejections);
  return isRejectionMemory(stored) ? stored : emptyRejections();
}

/** Come `add.ts`: accetta anche la forma scritta prima che le voci avessero un id. */
async function readManual(): Promise<ManualItem[]> {
  const stored = await getSetting<unknown>(SETTING_KEYS.manual);
  if (isManualList(stored)) return stored;
  if (!Array.isArray(stored)) return [];
  const now = new Date().toISOString();
  const out: ManualItem[] = [];
  for (const e of stored) {
    if (typeof e !== "object" || e === null || typeof (e as { product?: unknown }).product !== "string") continue;
    const r = e as { id?: unknown; product: string; quantity?: { value: number; unit: "g" | "ml" | "pz" }; addedAt?: unknown };
    const quantity = baseQuantityOf(r.quantity);
    out.push({ id: typeof r.id === "string" ? r.id : generateId(), product: r.product, ...(quantity ? { quantity } : {}), addedAt: typeof r.addedAt === "string" ? r.addedAt : now });
  }
  return out;
}

const NO_ACTION: () => Promise<boolean> = async () => false;

let writing = false;

/** Una scrittura alla volta: un secondo tocco mentre la prima è in corso non fa niente (`undefined`). */
async function guarded(write: () => Promise<boolean>): Promise<boolean | undefined> {
  if (writing) return undefined;
  writing = true;
  try {
    return await write();
  } catch {
    return false;
  } finally {
    writing = false;
  }
}

function ShoppingView({ data, undo }: { data: ShoppingData; undo: Undo }) {
  const view = data.view!;
  const [open, setOpen] = useState<OpenSheet | null>(null);
  const sheetId = open?.kind === "item" ? open.id : null;
  const setSheetId = (id: string | null) => setOpen(id === null ? null : { kind: "item", id });
  const run = guarded;

  const unconfirmed = view.items.filter((i) => !i.confirmed);
  const sospese = [...view.dismissed, ...view.suppressed];
  const listCount = view.items.length + view.noQuantity.length;
  // la spesa dei tre periodi si calcola una volta, qui: la riga «Costi e prezzi», la sezione e i fogli leggono lo stesso risultato
  const summaries = useMemo(() => {
    const pantry = data.plan.pantry;
    return pantry ? spendRanges(view.today).map((r) => summarizeSpend(pantry, r)) : [];
  }, [data.plan.pantry, view.today]);
  const month = summaries.find((s) => s.range.id === "month") ?? null;
  const costSheet = useMemo(() => {
    if (open?.kind === "cost") return shoppingCostContent(view);
    if (open?.kind !== "spend") return null;
    const summary = summaries.find((s) => s.range.id === open.period);
    const cap = data.monthlyBudgetCents;
    const progress = month && cap !== null && open.period === "month" ? monthlyBudgetProgress(month, cap) : null;
    return summary ? spendContent(summary, summary.range, progress) : null;
  }, [open, view, summaries, month, data.monthlyBudgetCents]);

  async function removeManual(name: string, manualIds: readonly string[]): Promise<boolean> {
    const stored = await readManual();
    const gone = new Set(manualIds);
    return undo.apply(removedText(name, false), { [SETTING_KEYS.manual]: stored.filter((m) => !gone.has(m.id)) }, { [SETTING_KEYS.manual]: stored });
  }

  async function removeProposal(v: ViewItem): Promise<boolean> {
    const [decisions, memory] = await Promise.all([readDecisions(), readRejections()]);
    const next = reject(decisions, memory, v.item, view.today);
    return undo.apply(
      removedText(v.name, true),
      { [SETTING_KEYS.decisions]: next.decisions, [SETTING_KEYS.rejections]: next.memory },
      { [SETTING_KEYS.decisions]: decisions, [SETTING_KEYS.rejections]: memory },
    );
  }

  async function changeDecisions(message: string, change: (d: Decisions) => Decisions): Promise<boolean> {
    const decisions = await readDecisions();
    return undo.apply(message, { [SETTING_KEYS.decisions]: change(decisions) }, { [SETTING_KEYS.decisions]: decisions });
  }

  function actionsFor(target: SheetTarget): ItemActions {
    if (target.kind === "plain") {
      const n = target.n;
      return { confirm: NO_ACTION, unconfirm: NO_ACTION, setQuantity: NO_ACTION, remove: async () => (await run(() => removeManual(n.name, n.manualIds))) ?? false };
    }
    const v = target.v;
    return {
      confirm: async () => (await run(() => changeDecisions(confirmedText(v.name, itemQuantityText(v)), (d) => confirm(d, v.id, v.quantity)))) ?? false,
      unconfirm: async () => (await run(() => changeDecisions(unconfirmedText(v.name), (d) => unconfirm(d, v.id)))) ?? false,
      setQuantity: async (value) =>
        (await run(() => changeDecisions(quantityChangedText(v.name, formatQuantity({ value, unit: v.unit })), (d) => setQuantity(d, v.id, value)))) ?? false,
      remove: async () => (await run(() => (v.isManual ? removeManual(v.name, v.manualIds) : removeProposal(v)))) ?? false,
    };
  }

  async function confirmAllNow() {
    await run(async () => {
      if (unconfirmed.length === 0) return true;
      return changeDecisions(confirmedAllText, (d) => confirmAll(d, unconfirmed));
    });
  }

  async function proposeAgain(v: ViewItem) {
    await run(async () => {
      const [decisions, memory] = await Promise.all([readDecisions(), readRejections()]);
      return undo.apply(
        proposedAgainText(v.name),
        { [SETTING_KEYS.rejections]: forgetRejections(memory, v.id), [SETTING_KEYS.decisions]: restore(decisions, v.id) },
        { [SETTING_KEYS.rejections]: memory, [SETTING_KEYS.decisions]: decisions },
      );
    });
  }

  const target: SheetTarget | null = useMemo(() => {
    if (sheetId === null) return null;
    const v = view.items.find((i) => i.id === sheetId);
    if (v) return { kind: "item", v };
    const n = view.noQuantity.find((q) => q.id === sheetId);
    return n ? { kind: "plain", n } : null;
  }, [sheetId, view.items, view.noQuantity]);

  // la voce non c'è più (tolta, o la lista è cambiata): il foglio non ha più di cui parlare
  if (sheetId !== null && target === null) setSheetId(null);

  const more: ActionItem[] = [
    ...(unconfirmed.length > 0 ? [{ id: "confirm-all", label: "Conferma tutte", onSelect: () => void confirmAllNow() }] : []),
    { id: "stock", label: "Scorte minime", href: "/app/spesa/scorte" },
    { id: "shelf", label: "Confronta sullo scaffale", href: "/app/qualita/scaffale" },
    { id: "quality", label: "Qualità dei prodotti", href: "/app/qualita" },
    { id: "week", label: "Pianifica la settimana", href: "/app/piano/settimana" },
  ];

  const bar = barState({ listCount, tripOn: data.trip !== null, lastTripOn: data.lastTrip !== null });
  const noHistory = view.day.date === null && view.day.insufficientHistoryCount > 0;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Lista della spesa</h1>
        <MoreActions items={more} />
      </div>

      <div className={styles.addBlock}>
        <AddField undo={undo} />
        {view.day.date !== null ? <p className={ui.paragraph}>{view.dayText}</p> : null}
      </div>

      <section className={ui.section} aria-label="Voci">
        <SectionHeader label={`Da comprare (${listCount})`} />
        {listCount > 0 ? <Hint id="shoppingRow" /> : null}
        {listCount === 0 ? (
          <p className={ui.paragraph}>Niente da comprare per ora.</p>
        ) : (
          <ul className={cx(styles.list, ui.group)}>
            {view.items.map((v) => (
              <li key={v.id} className={styles.line}>
                <button type="button" className={styles.lineButton} aria-haspopup="dialog" onClick={() => setSheetId(v.id)}>
                  <span className={styles.lineHead}>
                    <span className={styles.lineName}>{v.name}</span>
                    <span className={styles.lineQty}>{itemQuantityText(v)}</span>
                  </span>
                  <Subline text={itemSubline(v)} />
                </button>
              </li>
            ))}
            {view.noQuantity.map((n) => (
              <li key={n.id} className={styles.line}>
                <button type="button" className={styles.lineButton} aria-haspopup="dialog" onClick={() => setSheetId(n.id)}>
                  <span className={styles.lineHead}>
                    <span className={styles.lineName}>{n.name}</span>
                    <span className={styles.lineQty}>—</span>
                  </span>
                  <Subline text="aggiunta da te" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className={styles.disclosures}>
        <Disclosure title="Costi e prezzi" summary={month ? costsSummary(month) : undefined}>
          <Costs data={data} undo={undo} onOpenCost={() => setOpen({ kind: "cost" })} />
          <Spending data={data} undo={undo} summaries={summaries} onOpen={(period) => setOpen({ kind: "spend", period })} />
          <Prices view={view} />
          <Link href="/app/salute/nutrizione" className={ui.textLink}>
            Costo per nutriente
          </Link>
        </Disclosure>

        {sospese.length > 0 ? (
          <Disclosure title={`Sospese (${sospese.length})`} summary={sospese.map((v) => v.name).join(", ")}>
            <p className={ui.hint}>Le hai tolte tu, o le hai rifiutate più volte: non le propongo finché non lo chiedi. Restano qui, mai nascoste.</p>
            <ul className={cx(styles.list, ui.group)}>
              {sospese.map((v) => (
                <li key={v.id} className={styles.line}>
                  <div className={styles.lineStatic}>
                    <span className={styles.lineHead}>
                      <span className={styles.lineName}>{v.name}</span>
                      <span className={styles.lineQty}>{itemQuantityText(v)}</span>
                    </span>
                    <Subline text={v.reasons[0] ?? null} />
                    <button type="button" className={styles.action} onClick={() => void proposeAgain(v)}>
                      Proponila di nuovo
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Disclosure>
        ) : null}
      </div>

      <div className={styles.footLines}>
        <Disclosure title="Che cosa significa" quiet>
          <p>Le voci sono proposte dai tuoi consumi, dalle scorte minime e dal piano: ognuna dice perché c&apos;è. Confermale, cambia la quantità o toglile: me lo ricordo.</p>
          {noHistory ? <p>{view.dayText}</p> : null}
          {data.planUnresolved > 0 ? (
            <p>
              Nel piano ci sono {data.planUnresolved} {data.planUnresolved === 1 ? "ricetta o preparazione" : "ricette o preparazioni"} che non riesco a scomporre in ingredienti: i loro ingredienti non sono nella lista.
            </p>
          ) : null}
          {data.coveredPreps.length > 0 ? (
            <p>
              <strong>Porzioni già pronte.</strong> {data.coveredPreps.map((c) => coveredText(c)).join(" ")}
            </p>
          ) : null}
        </Disclosure>
        <Link href="/app/piano" className={ui.textLink}>
          Torna al piano
        </Link>
      </div>

      {target ? <ItemSheet key={sheetId} target={target} actions={actionsFor(target)} onClose={() => setSheetId(null)} /> : null}
      {costSheet ? <BreakdownSheet {...costSheet} onClose={() => setOpen(null)} /> : null}

      {undo.node}

      {bar ? (
        <ActionBar>
          <Button href={bar.href} variant={bar.variant}>
            {bar.label}
          </Button>
        </ActionBar>
      ) : null}
    </div>
  );
}

function Subline({ text }: { text: string | null }) {
  return text ? <span className={styles.lineNote}>{text}</span> : null;
}

/** Il campo in cima: si scrive che cosa manca, Invio aggiunge e il campo resta pronto. */
function AddField({ undo }: { undo: Undo }) {
  const id = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function add() {
    const reading = readEntries(text);
    if (reading.items.length === 0 && reading.rejected.length === 0) return;
    if (reading.items.length === 0) {
      setMessage(notReadText(reading.rejected));
      return;
    }
    const ok = await guarded(async () => {
      const stored = await readManual();
      const next = mergeManualItems(stored, toInputs(reading), new Date().toISOString());
      return undo.apply(addedText(reading.items.map((i) => i.product)), { [SETTING_KEYS.manual]: next }, { [SETTING_KEYS.manual]: stored });
    });
    if (ok === undefined) return;
    if (!ok) {
      setMessage("Non sono riuscito a salvare. Riprova.");
      return;
    }
    // resta nel campo solo ciò che non si è letto
    setText(leftInField(reading.rejected));
    setMessage(reading.rejected.length > 0 ? notReadText(reading.rejected) : null);
    fieldRef.current?.focus();
  }

  const lines = Math.min(4, Math.max(1, text.split(/\r?\n/).length));

  return (
    <form
      className={ui.field}
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <label className={ui.fieldLabel} htmlFor={id}>
        Aggiungi alla spesa
      </label>
      <div className={styles.addRow}>
        <textarea
          ref={fieldRef}
          id={id}
          className={cx(ui.input, styles.addField)}
          rows={lines}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setMessage(null);
          }}
          onKeyDown={(e) => {
            // Invio aggiunge; a capo solo con Maiusc. Un testo incollato su più righe resta com'è.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="2 l latte, pane, 6 uova"
          enterKeyHint="done"
          autoComplete="off"
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? `${id}-msg` : undefined}
        />
        <Button type="submit" variant="outline">
          Aggiungi
        </Button>
      </div>
      {message ? (
        <p id={`${id}-msg`} className={ui.error} role="alert">
          {message}
        </p>
      ) : null}
    </form>
  );
}
