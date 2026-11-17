"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Button, Label, SectionHeader } from "@/design";
import { formatQuantity } from "@/core/units";
import { parseQuantityInUnit } from "../actions";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { Costs } from "./Costs";
import { coveredText } from "./planNeeds";
import { confirm, confirmAll, forgetRejections, reject, restore, setQuantity, unconfirm } from "./decisions";
import { parseManualLines, toManualItems } from "./manual";
import { SETTING_KEYS } from "./settings";
import { useShoppingData, type ShoppingData } from "./useShoppingData";
import { useSettingsUndo } from "./useSettingsUndo";
import type { ViewItem } from "./view";
import styles from "./shopping.module.css";

type Undo = ReturnType<typeof useSettingsUndo>;

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

function ShoppingView({ data, undo }: { data: ShoppingData; undo: Undo }) {
  const view = data.view!;
  const { decisions, rejections } = data;
  const unconfirmed = view.items.filter((i) => !i.confirmed);

  async function setDecisions(message: string, next: typeof decisions) {
    await undo.apply(message, { [SETTING_KEYS.decisions]: next }, { [SETTING_KEYS.decisions]: decisions });
  }

  async function onReject(v: ViewItem) {
    if (v.isManual) {
      const gone = new Set(v.manualIds);
      await undo.apply(`Tolto dalla lista: ${v.name}.`, { [SETTING_KEYS.manual]: data.manual.filter((m) => !gone.has(m.id)) }, { [SETTING_KEYS.manual]: data.manual });
      return;
    }
    const r = reject(decisions, rejections, v.item, view.today);
    await undo.apply(`Rifiutato: ${v.name}. Me lo ricordo.`, { [SETTING_KEYS.decisions]: r.decisions, [SETTING_KEYS.rejections]: r.memory }, { [SETTING_KEYS.decisions]: decisions, [SETTING_KEYS.rejections]: rejections });
  }

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Lista della spesa</h1>
        <Label>Stime</Label>
      </div>
      <p className={ui.lead}>
        Le voci sono proposte dai tuoi consumi, dalle scorte minime e dal piano: ognuna dice perché c&apos;è. Confermale, cambia la quantità o rifiutale: me lo ricordo.
      </p>

      <section className={styles.dayCard} aria-label="Giorno consigliato">
        <Label>Prossima spesa</Label>
        <p className={styles.costLine}>{view.dayText}</p>
      </section>

      <AddManual data={data} undo={undo} />

      {data.planUnresolved > 0 ? (
        <p className={ui.hint}>
          Nel piano ci sono {data.planUnresolved} {data.planUnresolved === 1 ? "ricetta o preparazione" : "ricette o preparazioni"} che non riesco a scomporre in ingredienti: i loro ingredienti non sono nella lista.
        </p>
      ) : null}

      {data.coveredPreps.length > 0 ? (
        <div className={styles.card} aria-label="Porzioni già pronte">
          <Label>Porzioni già pronte</Label>
          <ul className={styles.reasons}>
            {data.coveredPreps.map((c) => (
              <li key={c.prepId}>{coveredText(c)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className={ui.section} aria-label="Voci">
        <SectionHeader label={`Da comprare (${view.items.length})`} />
        {view.items.length === 0 && view.noQuantity.length > 0 ? <p className={ui.paragraph}>Nessuna proposta: ci sono solo le voci senza quantità, qui sotto.</p> : null}
        {view.items.length === 0 && view.noQuantity.length === 0 ? (
          <EmptyState
            title="Niente da comprare per ora"
            text="Qui compariranno gli alimenti che stanno per finire, quelli sotto la scorta minima, quelli che servono al piano e ciò che aggiungi tu, ognuno con la sua ragione."
            actionLabel="Pianifica la settimana"
            actionHref="/app/piano/settimana"
            secondaryLabel="Imposta le scorte minime"
            secondaryHref="/app/spesa/scorte"
          />
        ) : view.items.length === 0 ? null : (
          <ul className={styles.items}>
            {view.items.map((v) => (
              <ItemCard
                key={v.id}
                v={v}
                onConfirm={() => setDecisions(`Confermato: ${v.name}, ${formatQuantity({ value: v.quantity, unit: v.unit })}.`, confirm(decisions, v.id, v.quantity))}
                onUnconfirm={() => setDecisions(`Di nuovo una proposta: ${v.name}.`, unconfirm(decisions, v.id))}
                onQuantity={(q) => setDecisions(`${v.name}: ${formatQuantity({ value: q, unit: v.unit })}.`, setQuantity(decisions, v.id, q))}
                onReject={() => onReject(v)}
              />
            ))}
          </ul>
        )}
      </section>

      {view.noQuantity.length > 0 ? (
        <section className={ui.section} aria-label="Senza quantità">
          <SectionHeader label={`Senza quantità (${view.noQuantity.length})`} />
          <p className={ui.hint}>Voci aggiunte senza una quantità, per esempio «q.b.»: ci sono in lista e vanno in negozio, ma non c&apos;è un numero.</p>
          <ul className={styles.items}>
            {view.noQuantity.map((n) => (
              <li key={n.id} className={styles.item}>
                <div className={styles.itemHead}>
                  <h3 className={styles.itemName}>{n.name}</h3>
                  <span className={styles.itemQty}>q.b.</span>
                </div>
                <p className={styles.meta}>Aggiunta da te. Nessun prezzo stimato: manca la quantità.</p>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.actionDanger}
                    onClick={() => {
                      const gone = new Set(n.manualIds);
                      void undo.apply(`Tolto dalla lista: ${n.name}.`, { [SETTING_KEYS.manual]: data.manual.filter((m) => !gone.has(m.id)) }, { [SETTING_KEYS.manual]: data.manual });
                    }}
                  >
                    Togli
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.items.length + view.noQuantity.length > 0 ? (
        <div className={ui.row}>
          <Button href="/app/spesa/negozio">{data.trip ? "Riprendi la spesa" : "Vai in negozio"}</Button>
          {unconfirmed.length > 0 ? (
            <Button variant="outline" onClick={() => setDecisions("Confermate tutte le voci.", confirmAll(decisions, unconfirmed))}>
              Conferma tutte
            </Button>
          ) : null}
        </div>
      ) : data.trip || data.lastTrip ? (
        <Button href="/app/spesa/negozio" variant="outline">
          {data.trip ? "Riprendi la spesa" : "Vedi l'ultima spesa"}
        </Button>
      ) : null}

      <Link href="/app/qualita/scaffale" className={ui.textLink}>
        Confronta sullo scaffale
      </Link>

      {view.suppressed.length > 0 ? (
        <section className={ui.section} aria-label="Proposte sospese">
          <SectionHeader label={`Sospese (${view.suppressed.length})`} />
          <p className={ui.hint}>Le hai rifiutate più volte: non le propongo più finché non lo chiedi. Restano qui, mai nascoste.</p>
          <ul className={styles.items}>
            {view.suppressed.map((v) => (
              <li key={v.id} className={styles.item}>
                <div className={styles.itemHead}>
                  <h3 className={styles.itemName}>{v.name}</h3>
                  <span className={styles.itemQty}>{formatQuantity({ value: v.quantity, unit: v.unit })}</span>
                </div>
                <ul className={styles.reasons}>
                  {v.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.action}
                    onClick={() =>
                      undo.apply(
                        `Di nuovo tra le proposte: ${v.name}.`,
                        { [SETTING_KEYS.rejections]: forgetRejections(rejections, v.id), [SETTING_KEYS.decisions]: restore(decisions, v.id) },
                        { [SETTING_KEYS.rejections]: rejections, [SETTING_KEYS.decisions]: decisions },
                      )
                    }
                  >
                    Proponila di nuovo
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Costs data={data} undo={undo} />

      <div className={ui.row}>
        <Link href="/app/spesa/scorte" className={ui.textLink}>
          Scorte minime
        </Link>
        <Link href="/app/qualita" className={ui.textLink}>
          Qualità di ciò che mangi
        </Link>
        <Link href="/app/piano" className={ui.textLink}>
          Torna al piano
        </Link>
      </div>
      {undo.node}
    </div>
  );
}

function ItemCard({
  v,
  onConfirm,
  onUnconfirm,
  onQuantity,
  onReject,
}: {
  v: ViewItem;
  onConfirm: () => void;
  onUnconfirm: () => void;
  onQuantity: (value: number) => void;
  onReject: () => void;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const r = parseQuantityInUnit(text, v.unit);
    if (!r.ok) return setError(r.error);
    onQuantity(r.quantity.value);
    setEditing(false);
    setError(null);
  }

  return (
    <li className={styles.item}>
      <div className={styles.itemHead}>
        <h3 className={styles.itemName}>{v.name}</h3>
        <span className={styles.itemQty}>{formatQuantity({ value: v.quantity, unit: v.unit })}</span>
      </div>
      <ul className={styles.reasons}>
        {v.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {v.changed ? <p className={styles.meta}>Proposta: {formatQuantity({ value: v.proposedQuantity, unit: v.unit })}. Hai scelto tu la quantità.</p> : null}
      <p className={styles.meta}>
        {v.stockText}. Costo stimato: {v.costText}.
      </p>
      {v.forecastNote ? <p className={styles.meta}>{v.forecastNote}</p> : null}
      {v.notes.map((n) => (
        <p key={n} className={styles.meta}>
          {n}
        </p>
      ))}
      {v.confirmed ? <span className={styles.tag}>{v.isManual ? "Aggiunta da te" : "Confermata"}</span> : null}

      {editing ? (
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={id}>
            Quanto ne compri
          </label>
          <div className={styles.inline}>
            <input id={id} className={ui.input} value={text} onChange={(e) => setText(e.target.value)} placeholder={v.unit === "pz" ? "2" : v.unit === "ml" ? "1 l" : "500 g"} autoComplete="off" aria-invalid={error ? true : undefined} />
            <Button onClick={submit}>Salva</Button>
            <Button variant="text" onClick={() => setEditing(false)}>
              Annulla
            </Button>
          </div>
          {error ? <p className={ui.error}>{error}</p> : null}
        </div>
      ) : null}

      <div className={styles.actions}>
        {!v.confirmed ? (
          <button type="button" className={styles.action} onClick={onConfirm}>
            Conferma
          </button>
        ) : !v.isManual ? (
          <button type="button" className={styles.action} onClick={onUnconfirm}>
            Rimetti in proposta
          </button>
        ) : null}
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            setText(formatQuantity({ value: v.quantity, unit: v.unit }));
            setEditing(true);
          }}
        >
          Cambia quantità
        </button>
        <button type="button" className={styles.actionDanger} onClick={onReject}>
          {v.isManual ? "Togli" : "Rifiuta"}
        </button>
      </div>
    </li>
  );
}

function AddManual({ data, undo }: { data: ShoppingData; undo: Undo }) {
  const id = useId();
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function add() {
    const reading = parseManualLines(text);
    if (reading.items.length === 0) {
      setMessage(reading.rejected.length > 0 ? `Non capisco: «${reading.rejected.join("», «")}». Prova con «2 l latte» o «pane».` : "Scrivi almeno una voce.");
      return;
    }
    const added = toManualItems(reading.items, new Date().toISOString());
    const ok = await undo.apply(
      `Aggiunte alla lista: ${reading.items.map((i) => i.product).join(", ")}.`,
      { [SETTING_KEYS.manual]: [...data.manual, ...added] },
      { [SETTING_KEYS.manual]: data.manual },
    );
    if (!ok) return;
    setText("");
    const assumed = reading.items.filter((i) => i.assumedOne).map((i) => i.product);
    const parts: string[] = [];
    if (assumed.length > 0) parts.push(`Senza quantità: ${assumed.join(", ")} vale un pezzo.`);
    if (reading.rejected.length > 0) parts.push(`Non ho capito: «${reading.rejected.join("», «")}».`);
    setMessage(parts.length > 0 ? parts.join(" ") : null);
  }

  return (
    <form
      className={ui.field}
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <label className={ui.fieldLabel} htmlFor={id}>
        Aggiungi a mano <span className={ui.optional}>(una voce per riga)</span>
      </label>
      <textarea id={id} className={ui.input} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={"2 l latte\npane\n6 uova"} style={{ paddingBlock: "var(--space-5)" }} />
      {message ? <p className={ui.hint}>{message}</p> : null}
      <div>
        <Button type="submit" variant="outline">
          Aggiungi alla lista
        </Button>
      </div>
    </form>
  );
}
