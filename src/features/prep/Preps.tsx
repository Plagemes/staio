"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import type { AnyEvent } from "@/core/events";
import type { MealKind } from "@/core/diary";
import type { Lot } from "@/core/ledger";
import { proposePrepRepair, voidPrep, type PrepRecord, type PrepRepairResult } from "@/core/prep";
import { formatQuantity } from "@/core/units";
import { appendEvents, getAllEvents, getDeviceId, getPantry, useEventLog, usePantry, usePlan, usePreps } from "@/data";
import { Button, ExpiryTag, Label, SectionHeader } from "@/design";
import { buildConsume } from "../actions";
import { dayOf, formatCalendarDate, formatPrice } from "../format";
import { LOCATION_LABELS } from "../labels";
import { MEAL_KIND_LABELS, MEAL_KIND_ORDER, suggestMealKind } from "../meals";
import { useNotice } from "../notice";
import { ActionList, Sheet, closeSheetThen } from "../common";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import { Disclosure } from "../common/Disclosure";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { eatPortionInMeal } from "./compose";
import styles from "./prep.module.css";
import { RepairSheet } from "./RepairSheet";
import {
  cookByText,
  coverageText,
  portionsText,
  portionsUsedExplanation,
  prepRows,
  programTasks,
  repairItemText,
  repairItems,
  type PrepRow,
  type RepairItem,
} from "./view";

export function Preps() {
  const preps = usePreps();
  const plan = usePlan();
  const now = useNow();
  const log = useEventLog();
  const pantry = usePantry();
  const [openId, setOpenId] = useState<string | null>(null);
  const [repair, setRepair] = useState<{ item: RepairItem; result: Extract<PrepRepairResult, { ok: true }> } | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);

  const rows = useMemo(() => (preps.data && now ? prepRows(preps.data, now) : undefined), [preps.data, now]);
  const program = useMemo(
    () => (preps.data && plan.data && now ? programTasks(plan.data, preps.data, now) : undefined),
    [preps.data, plan.data, now],
  );
  const tasks = program?.tasks ?? [];
  const covered = program?.coverage ?? [];
  const repairs = useMemo(() => (preps.data && log.data ? repairItems(preps.data, log.data) : []), [preps.data, log.data]);

  async function startRepair(item: RepairItem) {
    setRepairError(null);
    const r = proposePrepRepair(item.prepId, await getAllEvents(), { deviceId: await getDeviceId() });
    if (!r.ok) setRepairError("Non c'è niente da sistemare per questa preparazione.");
    else setRepair({ item, result: r });
  }

  if (preps.error) return <StorageError />;
  if (!preps.data || !rows || !now) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Preparazioni</h1>
        <LoadingLine />
      </div>
    );
  }

  const selected = openId ? preps.data.preps.find((p) => p.prepId === openId) : undefined;
  const total = rows.active.length + rows.finished.length;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Preparazioni</h1>
        <Label>{rows.active.length === 1 ? "1 in corso" : `${rows.active.length} in corso`}</Label>
      </div>

      <div className={ui.row}>
        <Button href="/app/preparazioni/nuova">Nuova preparazione</Button>
        <Button href="/app/ricette" variant="outline">
          Parti da una ricetta
        </Button>
      </div>

      {repairs.length > 0 ? (
        <section className={ui.section} aria-label="Da sistemare">
          <SectionHeader label="Da sistemare" />
          {repairs.map((r) => (
            <div key={r.prepId} className={ui.calloutStrong}>
              <p className={ui.paragraph}>{repairItemText(r)}</p>
              <div>
                <Button variant="outline" onClick={() => void startRepair(r)}>
                  Sistema
                </Button>
              </div>
            </div>
          ))}
          {repairError ? (
            <p className={ui.error} role="alert">
              {repairError}
            </p>
          ) : null}
        </section>
      ) : null}

      {tasks.length > 0 || covered.length > 0 ? (
        <section className={ui.section} aria-label="Programma">
          <SectionHeader label="Da preparare" actionLabel="Il piano" actionHref="/app/piano" />
          {covered.map((c) => (
            <p key={c.prepId} className={styles.note}>
              <strong>{c.title}</strong>: {coverageText(c)}.
            </p>
          ))}
          <div>
            {tasks.map((t) => (
              <div key={`${t.task.prepId}-${t.task.cookBy}`} className={styles.task}>
                <span className={t.overdue ? styles.taskOverdue : styles.taskTitle}>{t.title}</span>
                <span className={styles.note}>
                  {cookByText(t)} · {t.task.servings === 1 ? "1 porzione" : `${t.task.servings} porzioni`}
                  {t.task.goodUntil ? ` · buone fino a ${formatCalendarDate(t.task.goodUntil)} (stima)` : ""}
                </span>
                {!t.task.lifeKnown ? <span className={styles.note}>Non so quanto durano: un solo lotto copre tutta la settimana.</span> : null}
                <div>
                  <Link
                    className={ui.textLink}
                    href={t.existing?.recipeId ? `/app/preparazioni/nuova?ricetta=${encodeURIComponent(t.existing.recipeId)}&porzioni=${t.task.servings}` : "/app/preparazioni/nuova"}
                  >
                    Prepara
                  </Link>
                </div>
              </div>
            ))}
          </div>
          <Disclosure quiet title="Che cosa significa">Le date vengono dal piano della settimana. La durata delle porzioni è una stima.</Disclosure>
        </section>
      ) : plan.data ? (
        <p className={ui.hint}>
          Se nel piano della settimana metti delle preparazioni, qui trovi cosa cucinare e entro quando.
        </p>
      ) : null}

      {total === 0 ? (
        <EmptyState
          title="Nessuna preparazione"
          text="Qui compariranno le cose che cucini in anticipo: porzioni rimaste, scadenza e costo per porzione. Si parte dagli ingredienti in dispensa, oppure da una ricetta."
          actionLabel="Prepara qualcosa"
          actionHref="/app/preparazioni/nuova"
          secondaryLabel="Scegli una ricetta"
          secondaryHref="/app/ricette"
        />
      ) : (
        <>
          {rows.active.length > 0 ? (
            <ul className={styles.list}>
              {rows.active.map((row) => (
                <PrepItem key={row.prep.prepId} row={row} onOpen={() => setOpenId(row.prep.prepId)} />
              ))}
            </ul>
          ) : (
            <p className={ui.hint}>Nessuna porzione rimasta.</p>
          )}
          {rows.finished.length > 0 ? (
            <details>
              <summary className={ui.fieldLabel}>
                {rows.finished.length === 1 ? "1 preparazione finita" : `${rows.finished.length} preparazioni finite`}
              </summary>
              <ul className={styles.list}>
                {rows.finished.map((row) => (
                  <PrepItem key={row.prep.prepId} row={row} onOpen={() => setOpenId(row.prep.prepId)} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}

      {repair ? (
        <RepairSheet item={repair.item} result={repair.result} lots={pantry.data?.lots ?? []} onClose={() => setRepair(null)} />
      ) : null}
      {selected && now ? <PrepSheet key={selected.prepId} prep={selected} now={now} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

function PrepItem({ row, onOpen }: { row: PrepRow; onOpen: () => void }) {
  const { prep, expiry } = row;
  return (
    <li className={styles.item}>
      <span className={styles.itemName}>{prep.title}</span>
      {expiry ? (
        <ExpiryTag level={expiry.level} estimated={expiry.estimated}>
          {expiry.text}
        </ExpiryTag>
      ) : null}
      <span className={styles.itemMeta}>
        <span>{portionsText(prep)}</span>
        {prep.location ? <span>{LOCATION_LABELS[prep.location]}</span> : null}
        {prep.cost.perPortionCents !== undefined ? (
          <span>
            {prep.cost.partial ? "almeno " : ""}
            {formatPrice(prep.cost.perPortionCents)} a porzione
          </span>
        ) : null}
      </span>
      <button type="button" className={styles.open} aria-label={`Apri ${prep.title}`} onClick={onOpen} />
    </li>
  );
}

interface PrepSheetProps {
  prep: PrepRecord;
  now: string;
  onClose: () => void;
}

type Built = { events: AnyEvent[]; message: string } | { error: string };

function PrepSheet({ prep, now, onClose }: PrepSheetProps) {
  const ids = useId();
  const notice = useNotice();
  const pantry = usePantry();
  const [kind, setKind] = useState<MealKind>(() => suggestMealKind(now));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Solo per mostrare o spegnere i pulsanti: ciò che si scrive si ricalcola dall'archivio al tocco.
  const shownLot: Lot | undefined = pantry.data?.lots.find((l) => l.lotId === prep.batchLotId);
  const canEat = prep.status === "active" && shownLot !== undefined && shownLot.remaining >= 1 - 1e-9;
  const today = dayOf(now);

  async function write(build: (deviceId: string) => Promise<Built>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const built = await build(await getDeviceId());
      if ("error" in built) {
        setError(built.error);
        return;
      }
      const written = await appendEvents(built.events);
      if (written.added === 0 || written.rejected.length > 0) {
        setError("Non sono riuscito a salvare. Riprova.");
        return;
      }
      // foglio chiuso prima dell'avviso
      closeSheetThen(() => notice.show({ message: built.message, undo: built.events }));
    } catch {
      setError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  const freshLot = async (): Promise<Lot | undefined> => (await getPantry()).lots.find((l) => l.lotId === prep.batchLotId);

  const eatInMeal = () =>
    write(async (deviceId) => {
      const lot = await freshLot();
      if (!lot) return { error: "Non trovo il lotto di porzioni." };
      const r = eatPortionInMeal(prep, lot, kind, { now: new Date().toISOString(), deviceId });
      return r.ok ? { events: r.events, message: r.message } : { error: r.error };
    });

  const eatOnly = () =>
    write(async (deviceId) => {
      const lot = await freshLot();
      if (!lot) return { error: "Non trovo il lotto di porzioni." };
      const r = buildConsume(lot, { kind: "text", text: "1" }, { now: new Date().toISOString(), deviceId });
      return r.ok ? { events: r.events, message: `Segnata mangiata una porzione di ${prep.title}.` } : { error: r.error };
    });

  const remove = () =>
    write(async (deviceId) => {
      const r = voidPrep(prep.prepId, await getAllEvents(), { now: () => new Date().toISOString(), deviceId });
      if (!r.ok) {
        if (r.reason === "portions_used") return { error: portionsUsedExplanation(prep) };
        if (r.reason === "already_voided") return { error: "Questa preparazione è già stata tolta." };
        return { error: "Non trovo questa preparazione." };
      }
      return { events: r.events, message: `Preparazione tolta: ${prep.title}. Gli ingredienti sono tornati in dispensa.` };
    });

  return (
    <Sheet
      title={prep.title}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button disabled={!canEat || busy} onClick={() => void eatInMeal()}>
            Mangia una porzione
          </Button>
          <Button variant="outline" disabled={!canEat || busy} onClick={() => void eatOnly()}>
            Segna solo come mangiata
          </Button>
        </>
      }
    >
      <>
        <p className={styles.note}>{portionsText(prep)}</p>

        <dl className={styles.data}>
          <div className={styles.dataRow}>
            <dt>Cucinata</dt>
            <dd>{formatCalendarDate(dayOf(prep.cookedAt))}</dd>
          </div>
          {prep.location ? (
            <div className={styles.dataRow}>
              <dt>Dove</dt>
              <dd>{LOCATION_LABELS[prep.location]}</dd>
            </div>
          ) : null}
          {prep.expiry && prep.status === "active" ? (
            <div className={styles.dataRow}>
              <dt>Scadenza</dt>
              <dd>
                ~{formatCalendarDate(prep.expiry.date)}
                {prep.expiry.date < today ? " (già passata)" : ""}
                <span className={styles.note}> Stima: fidati di vista e odore.</span>
              </dd>
            </div>
          ) : null}
          <div className={styles.dataRow}>
            <dt>Costo</dt>
            <dd>
              {prep.cost.perPortionCents !== undefined
                ? `${prep.cost.partial ? "almeno " : ""}${formatPrice(prep.cost.perPortionCents)} a porzione`
                : "non noto"}
              {prep.cost.partial ? <span className={styles.note}> Manca il prezzo di qualche ingrediente.</span> : null}
            </dd>
          </div>
          <div className={styles.dataRow}>
            <dt>Usate</dt>
            <dd>
              {prep.eaten} mangiate
              {prep.discarded > 0 ? `, ${prep.discarded} buttate` : ""}
              {prep.gifted > 0 ? `, ${prep.gifted} regalate` : ""}
            </dd>
          </div>
          <div className={styles.dataRow}>
            <dt>Ingredienti</dt>
            <dd>{prep.ingredients.map((i) => `${i.productRef} ${formatQuantity(i.quantity)}`).join(", ")}</dd>
          </div>
        </dl>

        {canEat ? (
          <fieldset className={ui.field}>
            <legend className={ui.fieldLabel}>Dentro quale pasto</legend>
            <div className={ui.choices}>
              {MEAL_KIND_ORDER.map((k) => (
                <label key={k} className={ui.choice}>
                  <input type="radio" name={`${ids}-kind`} value={k} checked={kind === k} onChange={() => setKind(k)} />
                  <span>{MEAL_KIND_LABELS[k]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {error ? (
          <p className={ui.calloutStrong} role="alert">
            {error}
          </p>
        ) : null}

        <Disclosure quiet title="Che cosa significa">
          «Mangia una porzione» registra un pasto con questa porzione. Togliere la preparazione rimette gli ingredienti in dispensa: non si può
          se ne hai già mangiate.
        </Disclosure>
        <ActionList items={[{ id: "remove", label: "Togli la preparazione", danger: true, disabled: busy, onSelect: () => void remove() }]} />
      </>
    </Sheet>
  );
}
