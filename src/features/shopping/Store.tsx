"use client";

import Link from "next/link";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { Location } from "@/core/ledger";
import { checkItem, finishTrip, reconcile, startTrip, syncTrip, tripProgress, uncheckItem, type TripState } from "@/core/shopping";
import { formatQuantity } from "@/core/units";
import { appendEvents, getDeviceId, getPantry, getSetting, setSetting } from "@/data";
import { Button, Label, SectionHeader } from "@/design";
import { ActionBar } from "../common/ActionBar";
import { ActionList } from "../common/ActionList";
import { Disclosure } from "../common/Disclosure";
import { Sheet } from "../common/Sheet";
import { closeSheetThen } from "../common/sheetHistory";
import { useWakeLock } from "../common/useWakeLock";
import { FOOD_CATEGORY_GROUPS, FOOD_CATEGORY_LABELS, LOCATION_LABELS, LOCATION_ORDER } from "../labels";
import { ITEM_DEFAULTS_KEY, readItemDefault } from "../memory/itemDefaults";
import { useItemDefaults } from "../memory/useItemDefaults";
import { useNotice } from "../notice";
import { useProducts } from "../nutrition/useNutrition";
import { qualityHref, SHELF_PATH } from "../quality/links";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { addManualEntries } from "./add";
import { pruneDecisions, useShoppingData, type ShoppingData } from "./useShoppingData";
import { SETTING_KEYS, isTrip } from "./settings";
import { qualityFlags } from "./storeQuality";
import {
  addedToListText,
  alreadyReason,
  alreadyTitle,
  blockingText,
  checkText,
  cartCount,
  compactRow,
  compareSummary,
  finishLabel,
  missingText,
  newTripSummary,
  NO_WAKE_LOCK_TEXT,
  putAwayDoneText,
  putAwayLabel,
  putAwayTitle,
  readAddText,
  rowDetail,
  statusText,
  tripEstimate,
} from "./storeText";
import {
  appendHistory,
  buildPutAway,
  learnDefaults,
  linesOfTrip,
  markPutAway,
  missingOf,
  needsCheck,
  putAwayRows,
  restoreDefaults,
  reconcileView,
  shoppingOrder,
  tripTotals,
  unmarkPutAway,
  withCategory,
  withoutPurchase,
  type AlreadyRow,
  type PutAwayRow,
} from "./trip";
import styles from "./store.module.css";

const SAVE_FAILED = "Non sono riuscito a salvare sul telefono. Riprova.";
/** Un secondo tocco sulla stessa casella entro questo tempo è un doppio tocco: non toglie la spunta appena messa. */
const DOUBLE_TAP_MS = 600;

type Save = ShoppingData["save"];

async function saveAll(save: Save, values: Record<string, unknown>): Promise<boolean> {
  for (const [key, value] of Object.entries(values)) if (!(await save(key, value))) return false;
  return true;
}

/** Per «Annulla» sull'avviso: un errore fa dire all'avviso che non si è potuto annullare. */
async function restore(save: Save, values: Record<string, unknown>): Promise<void> {
  if (!(await saveAll(save, values))) throw new Error("restore failed");
}

async function storedTrip(key: string): Promise<TripState | null> {
  const value = await getSetting<unknown>(key);
  return isTrip(value) ? value : null;
}

/** Modalità spesa: tutto sta sul dispositivo (impostazioni locali), quindi funziona anche senza rete. */
export function Store() {
  const data = useShoppingData();
  if (data.error) return <StorageError />;
  if (!data.ready || !data.view) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>In negozio</h1>
        <LoadingLine />
      </div>
    );
  }
  return data.trip ? <ActiveTrip data={data} trip={data.trip} /> : <Idle data={data} />;
}

/* ---------- prima di entrare, e dopo ---------- */

function StorePicker({ stores, value, onChange }: { stores: readonly string[]; value: string | null; onChange: (store: string | null) => void }) {
  const ids = useId();
  const known = value !== null && stores.includes(value);
  const [other, setOther] = useState(value !== null && !known);
  return (
    <fieldset className={ui.field}>
      <legend className={ui.fieldLabel}>Dove fai la spesa</legend>
      <div className={ui.choices}>
        {stores.map((s) => (
          <label key={s} className={ui.choice}>
            <input type="radio" name={`${ids}-s`} checked={value === s && !other} onChange={() => { setOther(false); onChange(s); }} />
            <span>{s}</span>
          </label>
        ))}
        <label className={ui.choice}>
          <input type="radio" name={`${ids}-s`} checked={other} onChange={() => { setOther(true); onChange(""); }} />
          <span>Un altro</span>
        </label>
        <label className={ui.choice}>
          <input type="radio" name={`${ids}-s`} checked={value === null && !other} onChange={() => { setOther(false); onChange(null); }} />
          <span>Non lo dico</span>
        </label>
      </div>
      {other ? <input className={ui.input} value={value ?? ""} onChange={(e) => onChange(e.target.value)} aria-label="Nome del negozio" placeholder="Nome del negozio" autoComplete="off" /> : null}
      <Disclosure quiet title="Che cosa significa">Il negozio serve a mettere le voci nell&apos;ordine in cui le hai spuntate le altre volte lì, e a stimare con i suoi prezzi.</Disclosure>
    </fieldset>
  );
}

function Idle({ data }: { data: ShoppingData }) {
  const view = data.view!;
  const pantry = data.plan.pantry!;
  const notice = useNotice();
  const { memory } = useItemDefaults();
  const [store, setStore] = useState<string | null>(data.lastTrip?.store ?? view.book.stores[0] ?? null);
  const starting = useRef(false);
  // voci che l'utente vuole mettere in dispensa anche se risultano già comprate
  const [force, setForce] = useState<ReadonlySet<string>>(new Set());
  // righe appena scritte: nascoste finché dispensa e segni non sono arrivati entrambi
  const [written, setWritten] = useState<{ pantry: unknown; last: unknown; ids: ReadonlySet<string> } | null>(null);

  const last = data.lastTrip;
  const state = useMemo(
    () => (last ? putAwayRows(last, pantry, (name) => readItemDefault(memory, name), { force }) : { pending: [], already: [] }),
    [last, pantry, memory, force],
  );
  const hidden = written && (written.pantry === pantry || written.last === last) ? written.ids : null;
  const rows = hidden ? state.pending.filter((r) => !hidden.has(r.id)) : state.pending;
  const already = hidden ? state.already.filter((a) => !hidden.has(a.row.id)) : state.already;
  const showLast = last !== null && cartCount(last) > 0;
  const listCount = view.items.length + view.noQuantity.length;

  async function start() {
    if (starting.current) return;
    starting.current = true;
    try {
      if (await storedTrip(SETTING_KEYS.trip)) return;
      const previous = await storedTrip(SETTING_KEYS.lastTrip);
      const trip = startTrip(linesOfTrip(view.items, view.noQuantity), { store, startedAt: new Date().toISOString() });
      if (!(await saveAll(data.save, { [SETTING_KEYS.trip]: trip, [SETTING_KEYS.lastTrip]: null }))) {
        notice.show({ message: SAVE_FAILED });
        return;
      }
      // l'ultima spesa esce: se c'era ancora qualcosa da mettere in dispensa, «Annulla» la riporta
      if (previous && rows.length > 0) {
        notice.show({ message: "Spesa iniziata.", onUndo: () => restore(data.save, { [SETTING_KEYS.trip]: null, [SETTING_KEYS.lastTrip]: previous }) });
      }
    } catch {
      notice.show({ message: SAVE_FAILED });
    } finally {
      starting.current = false;
    }
  }

  async function skip(row: PutAwayRow) {
    try {
      const stored = await storedTrip(SETTING_KEYS.lastTrip);
      if (!stored) return;
      const next = withoutPurchase(stored, row.id);
      if (next === stored) return;
      if (!(await data.save(SETTING_KEYS.lastTrip, next))) {
        notice.show({ message: SAVE_FAILED });
        return;
      }
      notice.show({ message: `Tolto: ${row.name}.`, onUndo: () => restore(data.save, { [SETTING_KEYS.lastTrip]: stored }) });
    } catch {
      notice.show({ message: SAVE_FAILED });
    }
  }

  const newTripBody = (
    <div className={styles.trip}>
      {listCount === 0 ? <p className={ui.hint}>La lista è vuota: puoi aggiungere le voci mentre giri.</p> : null}
      <StorePicker stores={view.book.stores} value={store} onChange={setStore} />
      <div>
        <Button variant={rows.length > 0 ? "outline" : "primary"} onClick={() => void start()}>
          Inizia la spesa
        </Button>
      </div>
    </div>
  );
  // finché c'è qualcosa da mettere in dispensa, quello è il lavoro di adesso: «Nuova spesa» sta richiusa sotto
  const newTrip =
    rows.length > 0 ? (
      <Disclosure title="Nuova spesa" summary={newTripSummary(listCount)}>
        {newTripBody}
      </Disclosure>
    ) : (
      <section className={ui.section} aria-label="Nuova spesa">
        <SectionHeader label="Nuova spesa" />
        {newTripBody}
      </section>
    );

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>In negozio</h1>
        <Link href="/app/spesa" className={ui.textLink}>
          Torna alla lista
        </Link>
      </div>
      {showLast && last ? (
        <LastTrip
          key={last.startedAt}
          trip={last}
          pantry={pantry}
          rows={rows}
          already={already}
          force={force}
          today={view.today}
          onForce={(id) => setForce((f) => new Set([...f, id]))}
          onSkip={(row) => void skip(row)}
          onWritten={(ids) => setWritten({ pantry, last, ids: new Set(ids) })}
        >
          {newTrip}
        </LastTrip>
      ) : (
        newTrip
      )}
    </div>
  );
}

/* ---------- la spesa in corso ---------- */

function ActiveTrip({ data, trip }: { data: ShoppingData; trip: TripState }) {
  const view = data.view!;
  const notice = useNotice();
  const { supported } = useWakeLock(true);
  const lines = useMemo(() => linesOfTrip(view.items, view.noQuantity), [view.items, view.noQuantity]);
  // la spesa segue la lista di adesso; si salva così allineata solo con la prossima azione dell'utente
  const synced = useMemo(() => syncTrip(trip, lines), [trip, lines]);
  const ordered = useMemo(() => shoppingOrder(synced, data.history), [synced, data.history]);
  const estimate = tripEstimate(synced, tripTotals(synced, view.book));
  const products = useProducts();
  const flags = useMemo(() => qualityFlags(ordered.map((o) => o.item), products), [ordered, products]);

  // le spunte appena toccate, finché la spesa salvata non arriva: valgono solo per la spesa da cui sono partite
  const [marks, setMarks] = useState<{ base: TripState; ids: Record<string, boolean> } | null>(null);
  const shown = marks && marks.base === trip ? marks.ids : {};
  const isDone = (id: string, checkedAt: string | undefined) => (id in shown ? shown[id] : checkedAt !== undefined);
  const checked = ordered.filter((o) => isDone(o.item.id, o.item.checkedAt)).length;
  const progress = { checked, total: tripProgress(synced).total };
  const cart = checked + synced.offList.length;

  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastTap = useRef<{ id: string; at: number } | null>(null);
  const finishing = useRef(false);

  /** Le scritture una dopo l'altra, ognuna sulla spesa salvata riletta e allineata alla lista. */
  function enqueue<T>(run: () => Promise<T>, fallback: T): Promise<T> {
    const next = queue.current.then(run).catch(() => fallback);
    queue.current = next;
    return next;
  }

  function update(change: (current: TripState) => TripState): Promise<boolean> {
    return enqueue(async () => {
      const stored = await storedTrip(SETTING_KEYS.trip);
      if (!stored) return false;
      const next = change(syncTrip(stored, lines));
      return next === stored ? true : data.save(SETTING_KEYS.trip, next);
    }, false);
  }

  /** `tapAt`: l'istante del tocco (dall'evento), per riconoscere il doppio tocco. */
  function toggle(id: string, done: boolean, tapAt: number) {
    if (lastTap.current && lastTap.current.id === id && tapAt - lastTap.current.at < DOUBLE_TAP_MS) return;
    lastTap.current = { id, at: tapAt };
    const want = !done;
    setMarks((m) => ({ base: trip, ids: { ...(m && m.base === trip ? m.ids : {}), [id]: want } }));
    void update((t) => (want ? checkItem(t, id, new Date().toISOString()) : uncheckItem(t, id))).then((ok) => {
      if (ok) return;
      setMarks(null);
      notice.show({ message: SAVE_FAILED });
    });
  }

  async function add(text: string): Promise<string | null> {
    const { entries, rejected } = readAddText(text);
    if (entries.length === 0) return rejected.length > 0 ? `Non capisco «${rejected[0]}»: scrivi il nome, per esempio «pane» o «2 l latte».` : null;
    try {
      const result = await addManualEntries(entries);
      await update((t) => t);
      notice.show({ message: addedToListText(entries.map((e) => e.product)), onUndo: result.undo });
      return rejected.length > 0 ? `Non ho capito: ${rejected.join(", ")}.` : null;
    } catch {
      return SAVE_FAILED;
    }
  }

  function changeStore(store: string | null) {
    const clean = store?.trim() ? store.trim() : null;
    void update((t) => (t.store === clean ? t : { ...t, store: clean })).then((ok) => {
      if (!ok) notice.show({ message: SAVE_FAILED });
    });
  }

  function leave() {
    void enqueue(async () => {
      const stored = await storedTrip(SETTING_KEYS.trip);
      if (!stored) return;
      const base = syncTrip(stored, lines);
      if (!(await data.save(SETTING_KEYS.trip, null))) {
        notice.show({ message: SAVE_FAILED });
        return;
      }
      notice.show({ message: "Spesa lasciata.", onUndo: () => restore(data.save, { [SETTING_KEYS.trip]: base }) });
    }, undefined);
  }

  function finish() {
    if (finishing.current) return;
    finishing.current = true;
    void enqueue(async () => {
      const stored = await storedTrip(SETTING_KEYS.trip);
      if (!stored) return;
      const base = syncTrip(stored, lines);
      const previousLast = await getSetting<unknown>(SETTING_KEYS.lastTrip);
      const { trip: done, record } = finishTrip(base, new Date().toISOString());
      const ok = await saveAll(data.save, {
        [SETTING_KEYS.trip]: null,
        [SETTING_KEYS.lastTrip]: done,
        [SETTING_KEYS.history]: record.order.length > 0 ? appendHistory(data.history, record) : data.history,
        [SETTING_KEYS.decisions]: pruneDecisions(data.decisions, view),
      });
      if (!ok) {
        notice.show({ message: SAVE_FAILED });
        return;
      }
      notice.show({
        message: "Spesa finita.",
        onUndo: () =>
          restore(data.save, {
            [SETTING_KEYS.trip]: base,
            [SETTING_KEYS.lastTrip]: isTrip(previousLast) ? previousLast : null,
            [SETTING_KEYS.history]: data.history,
            [SETTING_KEYS.decisions]: data.decisions,
          }),
      });
    }, undefined).finally(() => {
      finishing.current = false;
    });
  }

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>In negozio</h1>
        <TripMenu store={synced.store} stores={view.book.stores} onStore={changeStore} onLeave={leave} />
      </div>

      <div className={styles.trip}>
        <div className={styles.status} role="status" aria-live="polite">
          <p className={styles.statusLine}>{statusText(synced.store, progress, estimate)}</p>
          {!supported ? <p className={ui.hint}>{NO_WAKE_LOCK_TEXT}</p> : null}
        </div>
        <Link href={SHELF_PATH} className={ui.textLink}>
          Confronta sullo scaffale
        </Link>
        <AddField onAdd={add} />
        {ordered.length > 0 ? (
          <ul className={styles.list}>
            {ordered.map(({ item }) => {
              const done = isDone(item.id, item.checkedAt);
              return (
                <li key={item.id}>
                  <label className={done ? styles.rowDone : styles.row}>
                    <input type="checkbox" checked={done} onChange={(e) => toggle(item.id, done, e.timeStamp)} />
                    <span className={styles.name}>{item.name}</span>
                    <span className={styles.qty}>{item.quantity > 0 ? formatQuantity({ value: item.quantity, unit: item.unit }) : "—"}</span>
                  </label>
                  {flags.has(item.id) ? (
                    <Link className={styles.qualityNote} href={qualityHref(flags.get(item.id)!)} aria-label={`qualità: vedi la scheda di ${item.name}`}>
                      qualità: vedi
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={ui.hint}>Nessuna voce in lista: scrivi qui sopra ciò che compri.</p>
        )}
      </div>

      {synced.offList.length > 0 ? (
        <section className={ui.section} aria-label="Fuori lista">
          <SectionHeader label="Fuori lista" />
          <ul className={styles.putList}>
            {synced.offList.map((o) => (
              <li key={o.id} className={styles.putItem}>
                <span className={styles.line}>
                  <span>{o.quantity ? `${o.name}, ${formatQuantity(o.quantity)}` : o.name}</span>
                  <span>{o.priceCents !== undefined ? `${(o.priceCents / 100).toFixed(2).replace(".", ",")} €` : "senza prezzo"}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ActionBar>
        <Button className={styles.barButton} variant={cart > 0 ? "primary" : "outline"} onClick={finish}>
          {finishLabel(cart)}
        </Button>
      </ActionBar>
    </div>
  );
}

function AddField({ onAdd }: { onAdd: (text: string) => Promise<string | null> }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  async function submit() {
    if (busy.current || text.trim() === "") return;
    busy.current = true;
    try {
      const problem = await onAdd(text);
      setError(problem);
      if (problem === null || problem.startsWith("Non ho capito")) setText("");
    } finally {
      busy.current = false;
    }
  }

  return (
    <form
      className={styles.addForm}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      <input
        className={ui.input}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        placeholder="Aggiungi"
        aria-label="Aggiungi alla spesa"
        enterKeyHint="done"
        autoComplete="off"
        aria-invalid={error ? true : undefined}
      />
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function TripMenu({ store, stores, onStore, onLeave }: { store: string | null; stores: readonly string[]; onStore: (store: string | null) => void; onLeave: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"menu" | "store">("menu");
  const [choice, setChoice] = useState<string | null>(store);

  const body =
    step === "menu" ? (
      <ActionList
        items={[
          {
            id: "store",
            label: "Cambia negozio",
            hint: store ?? "Negozio non indicato",
            onSelect: () => {
              setChoice(store);
              setStep("store");
            },
          },
          { id: "list", label: "Torna alla lista", href: "/app/spesa" },
          { id: "leave", label: "Lascia la spesa", hint: "Non registra niente", danger: true, onSelect: () => closeSheetThen(onLeave) },
        ]}
      />
    ) : (
      <StorePicker stores={stores} value={choice} onChange={setChoice} />
    );

  const footer =
    step === "store" ? (
      <div className={styles.stepFooter}>
        <Button variant="text" onClick={() => setStep("menu")}>
          Indietro
        </Button>
        <Button onClick={() => closeSheetThen(() => onStore(choice))}>Fatto</Button>
      </div>
    ) : undefined;

  return (
    <>
      <Button
        variant="text"
        aria-haspopup="dialog"
        onClick={() => {
          setStep("menu");
          setOpen(true);
        }}
      >
        Altro
      </Button>
      {open ? (
        <Sheet title={step === "menu" ? "Altro" : "Cambia negozio"} onClose={() => setOpen(false)} footer={footer} onBack={step === "store" ? () => setStep("menu") : undefined}>
          {body}
        </Sheet>
      ) : null}
    </>
  );
}

/* ---------- dopo la spesa: in dispensa in un passo ---------- */

interface LastTripProps {
  trip: TripState;
  pantry: NonNullable<ShoppingData["plan"]["pantry"]>;
  rows: PutAwayRow[];
  already: AlreadyRow[];
  force: ReadonlySet<string>;
  today: string;
  onForce: (id: string) => void;
  onSkip: (row: PutAwayRow) => void;
  onWritten: (ids: string[]) => void;
  /** Il resto della schermata: sta prima della barra fissa, che va in coda. */
  children: ReactNode;
}

function LastTrip({ trip, pantry, rows: base, already, force, today, onForce, onSkip, onWritten, children }: LastTripProps) {
  const notice = useNotice();
  const ids = useId();
  const [edits, setEdits] = useState<Record<string, Partial<PutAwayRow>>>({});
  // aperta o chiusa a mano; senza scelta parte aperta la riga con la categoria dedotta dal nome
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // si è provato a salvare con un dato che manca: sotto il campo si dice che cosa scrivere
  const [asked, setAsked] = useState(false);
  const saving = useRef(false);

  const rows = base.map((r) => (edits[r.id] ? { ...r, ...edits[r.id] } : r));
  const missing = rows.map((r) => ({ row: r, missing: missingOf(r) }));
  const missingCount = missing.reduce((s, m) => s + m.missing.length, 0);
  const checkCount = rows.filter((r) => needsCheck(r)).length;
  const blocking = blockingText(missing.map((m) => ({ name: m.row.name, missing: m.missing })));

  const rec = useMemo(() => reconcile(trip, pantry), [trip, pantry]);
  const compare = reconcileView(rec, (id) => trip.items.find((i) => i.id === id)?.name ?? id);

  const patch = (row: PutAwayRow, change: Partial<PutAwayRow>) => {
    setEdits((e) => ({ ...e, [row.id]: { ...e[row.id], ...change } }));
    // una riga che si sta correggendo resta aperta anche quando il dato che mancava c'è
    setToggled((t) => (t[row.id] ? t : { ...t, [row.id]: true }));
    setErrors({});
  };

  async function submit() {
    if (saving.current || rows.length === 0) return;
    if (blocking !== null) {
      // la riga a cui manca un dato si apre, viene in vista e il fuoco va sul suo campo
      const first = missing.find((m) => m.missing.length > 0);
      if (first) {
        setAsked(true);
        setToggled((t) => ({ ...t, [first.row.id]: true }));
        const field = document.getElementById(`${ids}-${first.row.id}-${first.missing.includes("quantity") ? "q" : "c"}`);
        field?.closest("li")?.scrollIntoView({ block: "center" });
        field?.focus({ preventScroll: true });
      }
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      // si rilegge l'archivio: ciò che nel frattempo è già entrato in dispensa non si scrive una seconda volta
      const [fresh, storedLast] = await Promise.all([getPantry(), storedTrip(SETTING_KEYS.lastTrip)]);
      const current = storedLast ?? trip;
      const still = new Set(putAwayRows(current, fresh, () => undefined, { force }).pending.map((r) => r.id));
      const toWrite = rows.filter((r) => still.has(r.id));
      if (toWrite.length === 0) {
        onWritten(rows.map((r) => r.id));
        return;
      }
      const now = new Date().toISOString();
      const result = buildPutAway(toWrite, current.store, { now, deviceId: await getDeviceId() });
      if (!result.ok) {
        setErrors(result.errors);
        setToggled((t) => ({ ...t, ...Object.fromEntries(Object.keys(result.errors).map((id) => [id, true])) }));
        return;
      }
      const written = await appendEvents(result.events);
      if (written.added === 0 || written.rejected.length > 0) {
        setErrors({ _: "Non sono riuscito a salvare. Riprova." });
        return;
      }
      onWritten(toWrite.map((r) => r.id));
      const lotIds = Object.values(result.lots).flat();
      // il segno sulla spesa: una voce messa in dispensa non si ripropone, qualunque sia il tempo passato
      try {
        const latest = await storedTrip(SETTING_KEYS.lastTrip);
        if (latest) await setSetting(SETTING_KEYS.lastTrip, markPutAway(latest, result.lots));
      } catch {
        // senza segno restano il giorno della spesa e la rilettura prima di scrivere
      }
      let before: unknown;
      let remembered = true;
      try {
        before = await getSetting<unknown>(ITEM_DEFAULTS_KEY);
        await setSetting(ITEM_DEFAULTS_KEY, learnDefaults(before, toWrite, now));
      } catch {
        remembered = false;
      }
      const names = toWrite.map((r) => r.name);
      notice.show({
        message: putAwayDoneText(toWrite.length, remembered),
        undo: result.events,
        link: { label: "Vedi", href: "/app/dispensa" },
        // prima degli acquisti si tolgono i segni e ciò che la memoria ha imparato; un errore qui non ferma l'annullamento
        onUndo: async () => {
          try {
            const latest = await storedTrip(SETTING_KEYS.lastTrip);
            if (latest) await setSetting(SETTING_KEYS.lastTrip, unmarkPutAway(latest, lotIds));
          } catch {
            // il segno di un lotto annullato non vale comunque più
          }
          if (!remembered) return;
          try {
            await setSetting(ITEM_DEFAULTS_KEY, restoreDefaults(await getSetting<unknown>(ITEM_DEFAULTS_KEY), before, names));
          } catch {
            // la memoria propone soltanto: resta com'è
          }
        },
      });
    } catch {
      setErrors({ _: SAVE_FAILED });
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  const topNotes = [missingText(missingCount), checkText(checkCount)].filter((t): t is string => t !== null);

  return (
    <>
      <section className={ui.section} aria-label="Ultima spesa">
        {rows.length > 0 ? (
          <>
            <SectionHeader label={putAwayTitle(rows.length)} actionLabel="Scontrino" actionHref="/app/cattura/scontrino" />
            <div className={styles.trip}>
              {topNotes.length > 0 ? <p className={ui.hint}>{topNotes.join(" ")}</p> : null}
              <ul className={styles.putList}>
                {missing.map(({ row: r, missing: lacks }) => {
                  const err = errors[r.id];
                  const forced = lacks.length > 0 || err !== undefined;
                  const open = forced || (toggled[r.id] ?? needsCheck(r));
                  const detail = rowDetail(r, today);
                  if (!open) {
                    return (
                      <li key={r.id} className={styles.putItem}>
                        <button type="button" className={styles.putRow} aria-expanded="false" onClick={() => setToggled((t) => ({ ...t, [r.id]: true }))}>
                          <span className={styles.putText}>
                            <span>{compactRow(r)}</span>
                            <span className={styles.putDetail}>{detail}</span>
                          </span>
                        </button>
                      </li>
                    );
                  }
                  const fid = `${ids}-${r.id}`;
                  return (
                    <li key={r.id} className={styles.putItem}>
                      <div className={styles.putOpen}>
                        {forced ? (
                          <span className={`${styles.putRow} ${styles.putName}`}>{r.name}</span>
                        ) : (
                          <button type="button" className={`${styles.putRow} ${styles.putName}`} aria-expanded="true" onClick={() => setToggled((t) => ({ ...t, [r.id]: false }))}>
                            {r.name}
                          </button>
                        )}
                        <div className={styles.putFields}>
                          <div className={ui.field}>
                            <label className={ui.fieldLabel} htmlFor={`${fid}-q`}>
                              Quantità
                            </label>
                            <input
                              id={`${fid}-q`}
                              className={ui.input}
                              value={r.quantityText}
                              onChange={(e) => patch(r, { quantityText: e.target.value })}
                              autoComplete="off"
                              placeholder="500 g"
                              aria-invalid={lacks.includes("quantity") || undefined}
                            />
                            {asked && lacks.includes("quantity") ? <p className={ui.error}>Scrivi quanto, per esempio 500 g.</p> : null}
                          </div>
                          <div className={ui.field}>
                            <label className={ui.fieldLabel} htmlFor={`${fid}-c`}>
                              Categoria
                            </label>
                            <select
                              id={`${fid}-c`}
                              className={ui.input}
                              value={r.category}
                              onChange={(e) => patch(r, withCategory(r, e.target.value))}
                              aria-invalid={lacks.includes("category") || undefined}
                            >
                              <option value="">Scegli…</option>
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
                            <p className={ui.hint}>
                              {needsCheck(r) ? "Dedotta dal nome: controlla. " : ""}
                              {detail}
                            </p>
                          </div>
                          <div className={ui.field}>
                            <label className={ui.fieldLabel} htmlFor={`${fid}-l`}>
                              Dove lo riponi
                            </label>
                            <select
                              id={`${fid}-l`}
                              className={ui.input}
                              value={r.location}
                              onChange={(e) => patch(r, { location: e.target.value as Location, locationFrom: "chosen" })}
                            >
                              {LOCATION_ORDER.map((l) => (
                                <option key={l} value={l}>
                                  {LOCATION_LABELS[l]}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className={ui.field}>
                            <label className={ui.fieldLabel} htmlFor={`${fid}-p`}>
                              Prezzo <span className={ui.optional}>(facoltativo)</span>
                            </label>
                            <input
                              id={`${fid}-p`}
                              className={ui.input}
                              inputMode="decimal"
                              value={r.priceText}
                              onChange={(e) => patch(r, { priceText: e.target.value })}
                              autoComplete="off"
                              placeholder="3,50"
                            />
                          </div>
                        </div>
                        {err ? <p className={ui.error}>{err}</p> : null}
                        <div>
                          <Button variant="text" onClick={() => onSkip(r)}>
                            Togli
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        ) : (
          <>
            <SectionHeader label={`Ultima spesa${trip.store ? `, ${trip.store}` : ""}`} actionLabel="Scontrino" actionHref="/app/cattura/scontrino" />
            <p className={ui.paragraph}>
              {already.length > 0 ? "Ciò che hai spuntato risulta già in dispensa: lo vedi qui sotto." : "Ciò che hai spuntato è in dispensa."}
            </p>
          </>
        )}
      </section>

      {already.length > 0 ? (
        <Disclosure title={alreadyTitle(already.length)} summary="comprate nel giorno della spesa">
          <ul className={styles.putList}>
            {already.map(({ row: r, lot }) => (
              <li key={r.id} className={styles.putItem}>
                <div className={styles.line}>
                  <span className={styles.putText}>
                    <span>{r.name}</span>
                    <span className={styles.putDetail}>{alreadyReason(lot, today)}</span>
                  </span>
                  <Button variant="text" onClick={() => onForce(r.id)}>
                    Aggiungi lo stesso
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}

      <Disclosure title="Confronto con la lista" summary={compareSummary(compare)}>
        {compare.waiting ? (
          <p className={ui.paragraph}>Ancora nessun acquisto registrato per questa spesa.</p>
        ) : (
          <>
            <p className={ui.paragraph}>{compare.boughtText}</p>
            {compare.missing.length > 0 ? (
              <>
                <Label>Da recuperare</Label>
                <ul className={ui.bullets}>
                  {compare.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {compare.extra.length > 0 ? (
              <>
                <Label>Fuori lista</Label>
                <ul className={ui.bullets}>
                  {compare.extra.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <p className={ui.hint}>{compare.spentText}</p>
          </>
        )}
      </Disclosure>

      {children}

      {rows.length > 0 ? (
        <ActionBar>
          <div className={styles.barStack}>
            <Button className={styles.barButton} disabled={busy} onClick={() => void submit()}>
              {busy ? "Salvo…" : putAwayLabel(rows.length)}
            </Button>
            {blocking ? <p className={ui.hint}>{blocking}</p> : null}
            {errors._ ? (
              <p className={ui.error} role="alert">
                {errors._}
              </p>
            ) : null}
          </div>
        </ActionBar>
      ) : null}
    </>
  );
}
