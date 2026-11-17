"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { generateId, type Location } from "@/core/ledger";
import { addOffList, checkItem, finishTrip, reconcile, startTrip, tripProgress, uncheckItem, type TripState } from "@/core/shopping";
import { formatQuantity } from "@/core/units";
import { Button, Label, SectionHeader } from "@/design";
import { readQuantity } from "../capture";
import { parsePriceCents } from "../format";
import { FOOD_CATEGORY_GROUPS, FOOD_CATEGORY_LABELS, LOCATION_LABELS, LOCATION_ORDER } from "../labels";
import { useWriter } from "../plan/useWriter";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { pruneDecisions, useShoppingData, type ShoppingData } from "./useShoppingData";
import { useSettingsUndo } from "./useSettingsUndo";
import { SETTING_KEYS } from "./settings";
import { appendHistory, buildPurchases, linesOfTrip, purchaseRows, reconcileView, shoppingOrder, tripTotals, type PurchaseRow } from "./trip";
import styles from "./shopping.module.css";

type Undo = ReturnType<typeof useSettingsUndo>;

/** Modalità spesa: tutto sta sul dispositivo (impostazioni locali), quindi funziona anche senza rete. */
export function Store() {
  const data = useShoppingData();
  const undo = useSettingsUndo(data.save);
  if (data.error) return <StorageError />;
  if (!data.ready || !data.view) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>In negozio</h1>
        <LoadingLine />
      </div>
    );
  }
  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>In negozio</h1>
        <Label>Anche senza rete</Label>
      </div>
      {data.trip ? <ActiveTrip data={data} trip={data.trip} undo={undo} /> : <Idle data={data} undo={undo} />}
      <Link href="/app/spesa" className={ui.textLink}>
        Torna alla lista della spesa
      </Link>
      {undo.node}
    </div>
  );
}

/* ---------- prima di entrare ---------- */

function StorePicker({ stores, value, onChange }: { stores: readonly string[]; value: string | null; onChange: (store: string | null) => void }) {
  const ids = useId();
  const known = value !== null && stores.includes(value);
  const [other, setOther] = useState(value !== null && !known);
  return (
    <fieldset className={ui.field}>
      <legend className={ui.fieldLabel}>In quale negozio sei</legend>
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
      <p className={ui.hint}>Il negozio serve a mettere le voci nell&apos;ordine in cui le hai spuntate le altre volte lì, e a stimare con i suoi prezzi.</p>
    </fieldset>
  );
}

function Idle({ data, undo }: { data: ShoppingData; undo: Undo }) {
  const view = data.view!;
  const [store, setStore] = useState<string | null>(data.lastTrip?.store ?? view.book.stores[0] ?? null);

  async function start() {
    const lines = linesOfTrip(view.items, view.noQuantity);
    const trip = startTrip(lines, { store, startedAt: new Date().toISOString() });
    await undo.apply("Spesa iniziata.", { [SETTING_KEYS.trip]: trip, [SETTING_KEYS.lastTrip]: null }, { [SETTING_KEYS.trip]: null, [SETTING_KEYS.lastTrip]: data.lastTrip });
  }

  return (
    <>
      {data.lastTrip ? <LastTrip data={data} trip={data.lastTrip} /> : null}
      <section className={ui.section} aria-label="Nuova spesa">
        <SectionHeader label="Nuova spesa" />
        {view.items.length + view.noQuantity.length === 0 ? (
          <EmptyState
            title="La lista è vuota"
            text="Quando ci sono voci da comprare le trovi qui, nell'ordine in cui le spunti di solito, con bersagli grandi da usare con una mano sola."
            actionLabel="Vai alla lista della spesa"
            actionHref="/app/spesa"
          />
        ) : (
          <>
            <p className={ui.lead}>
              {view.items.length + view.noQuantity.length} {view.items.length + view.noQuantity.length === 1 ? "voce" : "voci"} in lista. {view.cost.text}
            </p>
            <StorePicker stores={view.book.stores} value={store} onChange={setStore} />
            <Button onClick={() => void start()}>{data.lastTrip ? "Inizia una nuova spesa" : "Inizia la spesa"}</Button>
          </>
        )}
      </section>
    </>
  );
}

/* ---------- la spesa in corso ---------- */

function ActiveTrip({ data, trip, undo }: { data: ShoppingData; trip: TripState; undo: Undo }) {
  const view = data.view!;
  const ordered = useMemo(() => shoppingOrder(trip, data.history), [trip, data.history]);
  const totals = tripTotals(trip, view.book);
  const progress = tripProgress(trip);
  const [changing, setChanging] = useState(false);

  const persist = (next: TripState) => data.save(SETTING_KEYS.trip, next);

  async function finish() {
    const { trip: done, record } = finishTrip(trip, new Date().toISOString());
    await undo.apply(
      "Spesa conclusa.",
      {
        [SETTING_KEYS.trip]: null,
        [SETTING_KEYS.lastTrip]: done,
        [SETTING_KEYS.history]: record.order.length > 0 ? appendHistory(data.history, record) : data.history,
        [SETTING_KEYS.decisions]: pruneDecisions(data.decisions, view),
      },
      { [SETTING_KEYS.trip]: trip, [SETTING_KEYS.lastTrip]: data.lastTrip, [SETTING_KEYS.history]: data.history, [SETTING_KEYS.decisions]: data.decisions },
    );
  }

  return (
    <>
      <div className={styles.card}>
        <p className={styles.costLine}>
          <strong>{trip.store ?? "Negozio non indicato"}</strong>
          {trip.store ? " · le voci sono nell'ordine in cui le hai spuntate qui le altre volte" : " · ordine alfabetico: scegli un negozio per l'ordine appreso"}
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.action} onClick={() => setChanging((c) => !c)}>
            {changing ? "Fatto" : "Cambia negozio"}
          </button>
        </div>
        {changing ? <StorePicker stores={view.book.stores} value={trip.store} onChange={(s) => void persist({ ...trip, store: s === null ? null : s })} /> : null}
      </div>

      <ul className={styles.bigList}>
        {ordered.map(({ item, seenInTrips }) => {
          const done = item.checkedAt !== undefined;
          return (
            <li key={item.id}>
              <label className={done ? styles.bigRowDone : styles.bigRow}>
                <input
                  type="checkbox"
                  checked={done}
                  onChange={() => void persist(done ? uncheckItem(trip, item.id) : checkItem(trip, item.id, new Date().toISOString()))}
                />
                <span className={styles.bigText}>
                  {item.name}
                  <span className={styles.bigSub}>
                    {item.quantity > 0 ? formatQuantity({ value: item.quantity, unit: item.unit }) : "senza quantità"}
                    {trip.store && !done && seenInTrips > 0 ? ` · di solito tra le prime` : ""}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {trip.items.length === 0 ? <p className={ui.paragraph}>Nessuna voce in lista: aggiungi qui sotto ciò che compri.</p> : null}

      <OffList trip={trip} onAdd={(next) => persist(next)} />

      {trip.offList.length > 0 ? (
        <section className={ui.section} aria-label="Fuori lista">
          <SectionHeader label="Fuori lista" />
          <ul className={styles.table}>
            {trip.offList.map((o) => (
              <li key={o.id} className={styles.rowLine}>
                <span>
                  {o.name}
                  {o.quantity ? `, ${formatQuantity(o.quantity)}` : ""}
                </span>
                <span>{o.priceCents !== undefined ? `${(o.priceCents / 100).toFixed(2).replace(".", ",")} €` : "senza prezzo"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className={styles.totalBar} role="status" aria-live="polite">
        <span className={styles.costLine}>
          <strong>
            {progress.checked} di {progress.total}
          </strong>{" "}
          {progress.total === 1 ? "voce spuntata" : "voci spuntate"}
        </span>
        <span className={styles.meta}>{totals.text} Sono stime dagli ultimi prezzi osservati.</span>
        <Button onClick={() => void finish()}>Ho finito</Button>
      </div>
    </>
  );
}

function OffList({ trip, onAdd }: { trip: TripState; onAdd: (next: TripState) => Promise<boolean> }) {
  const ids = useId();
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (name.trim() === "") return setError("Scrivi che cos'è.");
    let quantity: { value: number; unit: "g" | "ml" | "pz" } | undefined;
    if (qty.trim() !== "") {
      const q = readQuantity(qty);
      if (!q.ok) return setError(q.error);
      quantity = q.quantity;
    }
    let priceCents: number | undefined;
    if (price.trim() !== "") {
      const p = parsePriceCents(price);
      if (!p.ok) return setError("Scrivi il prezzo in euro, per esempio 3,50.");
      priceCents = p.cents;
    }
    setError(null);
    const next = addOffList(trip, { id: generateId(), name, ...(quantity ? { quantity } : {}), ...(priceCents !== undefined ? { priceCents } : {}), addedAt: new Date().toISOString() });
    if (await onAdd(next)) {
      setName("");
      setQty("");
      setPrice("");
    }
  }

  return (
    <form
      className={ui.form}
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
      noValidate
    >
      <SectionHeader label="Aggiungi fuori lista" />
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-n`}>
          Che cos&apos;è
        </label>
        <input id={`${ids}-n`} className={ui.input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </div>
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-q`}>
          Quantità <span className={ui.optional}>(facoltativa)</span>
        </label>
        <input id={`${ids}-q`} className={ui.input} value={qty} onChange={(e) => setQty(e.target.value)} autoComplete="off" placeholder="500 g" />
      </div>
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-p`}>
          Prezzo <span className={ui.optional}>(facoltativo)</span>
        </label>
        <input id={`${ids}-p`} className={ui.input} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} autoComplete="off" placeholder="3,50" />
      </div>
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="outline">
          Aggiungi
        </Button>
      </div>
    </form>
  );
}

/* ---------- dopo la spesa ---------- */

function LastTrip({ data, trip }: { data: ShoppingData; trip: TripState }) {
  const pantry = data.plan.pantry!;
  const rec = useMemo(() => reconcile(trip, pantry), [trip, pantry]);
  const nameOf = (id: string) => trip.items.find((i) => i.id === id)?.name ?? id;
  const view = reconcileView(rec, nameOf);
  const boughtIds = new Set(rec.bought.map((b) => b.itemId));
  const declared = new Set(rec.extra.filter((e) => e.declaredInTrip).map((e) => e.key));
  const rows = purchaseRows(trip, pantry).filter((r) => (r.fromList ? !boughtIds.has(r.id) : !declared.has(trip.offList.find((o) => o.id === r.id)?.key ?? "")));

  return (
    <>
      <section className={ui.section} aria-label="Ultima spesa">
        <SectionHeader label={`Ultima spesa${trip.store ? `, ${trip.store}` : ""}`} />
        {rows.length > 0 ? (
          <PurchaseForm key={rows.map((r) => r.id).join()} rows={rows} store={trip.store} />
        ) : (
          <p className={ui.paragraph}>Gli acquisti spuntati sono già registrati in dispensa.</p>
        )}
      </section>

      <section className={ui.section} aria-label="Riconciliazione">
        <SectionHeader label="Riconciliazione" actionLabel="Scontrino" actionHref="/app/cattura/scontrino" />
        {view.waiting ? (
          <p className={ui.paragraph}>Non vedo ancora acquisti registrati per questa spesa. Quando leggi lo scontrino o registri gli acquisti, qui confronto ciò che avevi in lista con ciò che hai comprato.</p>
        ) : (
          <>
            <p className={ui.paragraph}>{view.boughtText}</p>
            {view.missing.length > 0 ? (
              <>
                <Label>Da recuperare</Label>
                <ul className={styles.reasons}>
                  {view.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {view.extra.length > 0 ? (
              <>
                <Label>Fuori lista</Label>
                <ul className={styles.reasons}>
                  {view.extra.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <p className={ui.hint}>{view.spentText}</p>
          </>
        )}
      </section>
    </>
  );
}

function PurchaseForm({ rows: initial, store }: { rows: PurchaseRow[]; store: string | null }) {
  const write = useWriter();
  const [rows, setRows] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const patch = (id: string, change: Partial<PurchaseRow>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...change } : r)));
    setErrors({});
  };

  async function submit() {
    setBusy(true);
    let rowErrors: Record<string, string> = {};
    const failure = await write((ctx) => {
      const r = buildPurchases(rows, store, ctx);
      if (!r.ok) {
        rowErrors = r.errors;
        return { ok: false, error: "Controlla le voci indicate." };
      }
      return r;
    });
    setBusy(false);
    setErrors(failure ? { ...rowErrors, _: failure } : {});
  }

  return (
    <form
      className={ui.form}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      <p className={ui.lead}>Registra ciò che hai spuntato come entrate in dispensa. Dove non so la categoria o il luogo, te lo chiedo.</p>
      {rows.map((r) => {
        const err = errors[r.id];
        const params = new URLSearchParams({ nome: r.name });
        if (r.quantityText) params.set("quantita", r.quantityText);
        if (r.category) params.set("categoria", r.category);
        return (
          <div key={r.id} className={styles.card}>
            <strong className={styles.itemName}>{r.name}</strong>
            <div className={ui.field}>
              <label className={ui.fieldLabel} htmlFor={`${r.id}-q`}>
                Quantità
              </label>
              <input id={`${r.id}-q`} className={ui.input} value={r.quantityText} onChange={(e) => patch(r.id, { quantityText: e.target.value })} autoComplete="off" placeholder="500 g" />
            </div>
            <div className={ui.field}>
              <label className={ui.fieldLabel} htmlFor={`${r.id}-p`}>
                Prezzo <span className={ui.optional}>(facoltativo)</span>
              </label>
              <input id={`${r.id}-p`} className={ui.input} inputMode="decimal" value={r.priceText} onChange={(e) => patch(r.id, { priceText: e.target.value })} autoComplete="off" placeholder="3,50" />
            </div>
            <div className={ui.field}>
              <label className={ui.fieldLabel} htmlFor={`${r.id}-c`}>
                Categoria
              </label>
              <select id={`${r.id}-c`} className={ui.input} value={r.category} onChange={(e) => patch(r.id, { category: e.target.value })}>
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
            </div>
            <div className={ui.field}>
              <label className={ui.fieldLabel} htmlFor={`${r.id}-l`}>
                Dove lo riponi
              </label>
              <select id={`${r.id}-l`} className={ui.input} value={r.location} onChange={(e) => patch(r.id, { location: e.target.value as Location | "" })}>
                <option value="">Scegli…</option>
                {LOCATION_ORDER.map((l) => (
                  <option key={l} value={l}>
                    {LOCATION_LABELS[l]}
                  </option>
                ))}
              </select>
            </div>
            {err ? <p className={ui.error}>{err}</p> : null}
            <Link href={`/app/cattura?${params.toString()}`} className={ui.textLink}>
              Preferisco la cattura, con scadenza e codice a barre
            </Link>
          </div>
        );
      })}
      {errors._ ? (
        <p className={ui.error} role="alert">
          {errors._}
        </p>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? "Registro…" : `Registra ${rows.length} ${rows.length === 1 ? "acquisto" : "acquisti"}`}
      </Button>
    </form>
  );
}
