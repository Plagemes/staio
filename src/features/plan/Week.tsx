"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ALLERGEN_CHECK_NOTICE, deriveConfirmations } from "@/core/allergens";
import type { MealKind } from "@/core/diary";
import { addDays } from "@/core/diary";
import { checkPlanWeek, dayTypeOf, derivePlan, getWeek, weekDates, weekStartOf, type PlannedEntry } from "@/core/plan";
import { getAllEvents } from "@/data";
import { Button, Label, Tabs } from "@/design";
import { DIET_HREF, useDietDeclarations } from "../allergens";
import { Disclosure, MoreActions, type ActionItem } from "../common";
import { MEAL_KIND_ORDER } from "../meals";
import { IncompleteDeclarations } from "../recipes/SafetyPanel";
import { useDeclared } from "../recipes/useRecipeSafety";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { AddEntrySheet } from "./AddEntry";
import { CopyWeekSheet } from "./CopyWeekSheet";
import { DaySection, type DayItem } from "./DaySection";
import { WEEK_LABELS, dayFromParam, dayMonth, nextMonday, shortDayLower, weekChoices, weekRangeText, type WeekChoice, type WeekId } from "./dates";
import { buildClearDayType, buildDayType, buildWeek, copyDay } from "./edit";
import { EatSheet } from "./EatSheet";
import { entryRefs } from "./entryKey";
import { ItemSheet } from "./ItemSheet";
import { mealCount, mealsText } from "./tonight";
import { ProposalCard } from "./ProposalCard";
import { checkWeekConstraints } from "./safety";
import { usePlanData, type PlanData } from "./usePlanData";
import { PROPOSAL_UNAVAILABLE_TEXT, useProposal } from "./useProposal";
import { useWeekEditor } from "./useWeekEditor";
import { useWriter } from "./useWriter";
import { VerifyBody } from "./VerifyBody";
import { constraintLines, dayCheckView, daySummaryText, verifySummary } from "./verify";
import { CopyDaySheet, DayTypeSheet } from "./WeekSheets";
import { itemCommand } from "./itemCommand";
import { itemName } from "./describe";
import styles from "./plan.module.css";

type SheetState =
  | { type: "add"; date: string }
  | { type: "item"; item: DayItem }
  | { type: "eat"; entry: PlannedEntry }
  | { type: "copyDay"; date: string }
  | { type: "copyWeek" }
  | { type: "dayType"; date: string };

const PROPOSAL_EMPTY = "Non ho scritto niente: i posti sono stati occupati o il controllo di allergeni ed esclusioni ha fermato le proposte.";

/**
 * Settimana. `?giorno=AAAA-MM-GG` dice quale giorno mostrare (e quindi quale settimana; senza, oggi), `?proponi=1` avvia la
 * proposta, `?verifica=1` apre la verifica in fondo (come `openVerify`, per l'indirizzo della verifica).
 */
export function Week({ openVerify = false }: { openVerify?: boolean }) {
  return (
    <Suspense fallback={<WeekLoading />}>
      <WeekRoute openVerify={openVerify} />
    </Suspense>
  );
}

function WeekLoading() {
  return (
    <div className={ui.screen}>
      <h1 className={ui.title}>Settimana</h1>
      <LoadingLine />
    </div>
  );
}

function WeekRoute({ openVerify }: { openVerify: boolean }) {
  const data = usePlanData();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const stripParams = useCallback(
    (...names: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      let changed = false;
      for (const name of names) {
        if (params.has(name)) {
          params.delete(name);
          changed = true;
        }
      }
      if (!changed) return;
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  if (data.error) return <StorageError />;
  if (!data.ready || !data.plan) return <WeekLoading />;

  // il giorno è quello dell'indirizzo; la pagina resta viva tra una visita e l'altra, quindi non se ne tiene copia
  const requestedDay = searchParams.get("giorno");
  const day = dayFromParam(requestedDay, data.today);
  const weekStart = weekStartOf(day);
  const weeks = weekChoices(data.today);
  const shown: WeekChoice = weeks.find((w) => w.start === weekStart) ?? { id: weekStart < weeks[1].start ? "previous" : "next", start: weekStart, label: weekRangeText(weekStart) };

  const goTo = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("giorno");
    if (id === "next") params.set("giorno", nextMonday(data.today));
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <WeekView
      key={weekStart}
      data={data}
      weeks={weeks}
      week={shown}
      day={day}
      requestedDay={requestedDay}
      wantProposal={searchParams.get("proponi") === "1"}
      verifyParam={searchParams.get("verifica") === "1"}
      openVerify={openVerify}
      stripParams={stripParams}
      onWeek={goTo}
    />
  );
}

interface ViewProps {
  data: PlanData;
  weeks: WeekChoice[];
  week: WeekChoice;
  /** Il giorno da portare in vista. */
  day: string;
  requestedDay: string | null;
  wantProposal: boolean;
  verifyParam: boolean;
  openVerify: boolean;
  stripParams: (...names: string[]) => void;
  onWeek: (id: string) => void;
}

function WeekView({ data, weeks, week, day, requestedDay, wantProposal, verifyParam, openVerify, stripParams, onWeek }: ViewProps) {
  const plan = data.plan!;
  const write = useWriter();
  const edit = useWeekEditor();
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [using, setUsing] = useState(false);
  const state = getWeek(plan, week.start);
  const entries = useMemo(() => state?.entries ?? [], [state]);
  const refs = useMemo(() => entryRefs(entries), [entries]);
  const dates = useMemo(() => weekDates(week.start), [week.start]);
  const isCurrent = week.start === weekStartOf(data.today);
  const nextStart = addDays(week.start, 7);
  const structureMeals: MealKind[] = plan.structure ? plan.structure.meals.map((m) => m.kind) : [];
  const mealOrder: MealKind[] = structureMeals.length > 0 ? structureMeals : [...MEAL_KIND_ORDER];
  const mealTime = useMemo(() => new Map((plan.structure?.meals ?? []).map((m) => [m.kind, m.time])), [plan.structure]);
  const nameOfRef = (via: { kind: "recipe" | "prep"; id: string }) =>
    itemName(via.kind === "recipe" ? { kind: "recipe", recipeId: via.id, servings: 1 } : { kind: "prep", prepId: via.id, servings: 1 }, data.catalog);

  const check = useMemo(() => (data.nutrientsOf ? checkPlanWeek(plan, week.start, data.nutrientsOf) : undefined), [plan, week.start, data.nutrientsOf]);
  const confirmations = useMemo(() => deriveConfirmations(data.log ?? []).byKey, [data.log]);
  // allergeni ed esclusioni dalla lettura unica, non solo dal piano
  const { declared, ready: declaredReady } = useDeclared();
  const { state: declarations } = useDietDeclarations();
  // finché allergeni ed esclusioni non sono letti non c'è esito: mai una settimana «pulita» per liste ancora vuote
  const constraints = useMemo(
    () => (declaredReady ? checkWeekConstraints(declared, state, { expandForChecks: data.expandForChecks, linkOf: data.linkOf, confirmations }) : undefined),
    [declaredReady, declared, state, data.expandForChecks, data.linkOf, confirmations],
  );
  const proposal = useProposal({ data, weekStart: week.start, weekDates: dates, entries, declared, declaredReady, confirmations });
  const constraintItems = constraints ? constraintLines(constraints, nameOfRef) : [];
  const violations = constraintItems.filter((l) => l.kind === "violation");
  const unverified = constraintItems.filter((l) => l.kind === "unverified");
  const confirmedItems = constraintItems.filter((l) => l.kind === "confirmed");

  // --- giorni passati, verifica: aperti da chi arriva con un indirizzo che li chiede ---
  const pastDates = isCurrent ? dates.filter((d) => d < data.today) : [];
  const dayIsPast = pastDates.includes(day);
  const wantVerify = openVerify || verifyParam;
  const [pastOpen, setPastOpen] = useState(dayIsPast && requestedDay !== null);
  const [seenDay, setSeenDay] = useState(day);
  const [verifyOpen, setVerifyOpen] = useState(wantVerify);
  const [seenVerify, setSeenVerify] = useState(wantVerify);
  const [verifyNudge, setVerifyNudge] = useState(0);
  if (seenDay !== day) {
    setSeenDay(day);
    if (dayIsPast) setPastOpen(true);
  }
  if (seenVerify !== wantVerify) {
    setSeenVerify(wantVerify);
    if (wantVerify) setVerifyOpen(true);
  }

  // il giorno si porta in vista una volta per valore dell'indirizzo, e solo se sta in fondo allo schermo: ciò che sta sopra (avvisi) resta in vista
  useEffect(() => {
    const el = document.getElementById(`giorno-${day}`);
    if (el && el.getBoundingClientRect().top > window.innerHeight * 0.5) el.scrollIntoView({ block: "start" });
  }, [day, requestedDay]);

  const scrollToVerify = () => {
    // la riga si apre e prende posto prima di scorrere
    window.setTimeout(() => document.getElementById("verifica")?.scrollIntoView({ block: "start" }), 60);
  };
  useEffect(() => {
    if (wantVerify) scrollToVerify();
  }, [wantVerify]);
  useEffect(() => {
    if (verifyNudge > 0) scrollToVerify();
  }, [verifyNudge]);
  useEffect(() => {
    if (verifyParam) stripParams("verifica");
  }, [verifyParam, stripParams]);

  // --- proposta: `?proponi=1` la avvia all'arrivo ---
  useEffect(() => {
    if (!wantProposal) return;
    if (proposal.active) {
      stripParams("proponi");
    } else if (proposal.available && !proposal.unavailable) {
      proposal.start();
      stripParams("proponi");
    } else if (proposal.unavailable) {
      stripParams("proponi");
    }
  }, [wantProposal, proposal, stripParams]);

  const canPropose = proposal.available && !proposal.unavailable;
  const weekEmpty = entries.length === 0;
  const nothingAhead = entries.every((e) => e.date < data.today);
  const weekHasToday = dates.includes(data.today);
  const fullPropose = canPropose && !proposal.active && nothingAhead && !weekEmpty;
  const unavailableText = proposal.unavailable ? PROPOSAL_UNAVAILABLE_TEXT[proposal.unavailable] : null;

  async function applyProposal() {
    setUsing(true);
    setError(null);
    let zero = false;
    const failure = await edit((read, ctx) => {
      // le voci della settimana si rileggono dall'archivio: quelle aggiunte nel frattempo non si perdono
      const done = proposal.finalize(read(week.start));
      if (!done) return { ok: false, error: PROPOSAL_EMPTY };
      if (done.added === 0) {
        zero = true;
        return { ok: false, error: PROPOSAL_EMPTY };
      }
      const held = done.dropped > 0 ? ` ${done.dropped} ${done.dropped === 1 ? "non è stata scritta" : "non sono state scritte"}: posto occupato o fermata dal controllo di allergeni.` : "";
      return buildWeek(week.start, done.entries, ctx, `Aggiunti al piano ${done.added} ${done.added === 1 ? "pasto proposto" : "pasti proposti"}.${held}`);
    });
    setUsing(false);
    if (zero) proposal.discard();
    if (failure) setError(failure);
    else proposal.discard();
  }

  const close = () => setSheet(null);

  const pageActions: ActionItem[] = [
    ...(!fullPropose && !proposal.active && !weekEmpty
      ? [{ id: "propose", label: "Proponi la settimana", disabled: !canPropose, ...(unavailableText ? { hint: unavailableText } : {}), onSelect: proposal.start }]
      : []),
    { id: "copyWeek", label: "Copia un'altra settimana qui", onSelect: () => setSheet({ type: "copyWeek" }) },
    {
      id: "verify",
      label: "Verifica del piano",
      onSelect: () => {
        setVerifyOpen(true);
        setVerifyNudge((n) => n + 1);
      },
    },
  ];

  function daySection(date: string) {
    const items: DayItem[] = entries.flatMap((entry, i) => (entry.date === date ? [{ entry, ref: refs[i] }] : []));
    const dayType = dayTypeOf(plan, date);
    const fromDefault = !plan.dayTypes.some((d) => d.date === date);
    const view = check ? dayCheckView(check.days.find((d) => d.date === date)!) : undefined;
    return (
      <DaySection
        key={date}
        date={date}
        data={data}
        items={items}
        proposed={proposal.proposal?.meals.filter((m) => m.slot.date === date) ?? []}
        proposal={proposal}
        mealOrder={mealOrder}
        mealTime={mealTime}
        summary={view && view.checked ? daySummaryText(view) : ""}
        dayTypeText={dayType ? `${dayType}${fromDefault ? " (predefinita)" : ""}` : undefined}
        onOpen={(item) => setSheet({ type: "item", item })}
        onEat={(entry) => setSheet({ type: "eat", entry })}
        onAdd={() => setSheet({ type: "add", date })}
        onCopyDay={() => setSheet({ type: "copyDay", date })}
        onDayType={() => setSheet({ type: "dayType", date })}
      />
    );
  }

  const pastEntries = entries.filter((e) => e.date < data.today);
  const pastSummary =
    pastDates.length > 0 ? `${shortDayLower(pastDates[0])}${pastDates.length > 1 ? ` – ${shortDayLower(pastDates[pastDates.length - 1])}` : ""} · ${mealsText(mealCount(pastEntries))}` : "";
  const firstDay = weekHasToday ? data.today : week.start;
  const verifyWeek: WeekId = week.start === weeks[0].start ? "previous" : week.start === weeks[2].start ? "next" : "current";

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Settimana</h1>
        <Label>{weekRangeText(week.start)}</Label>
      </div>

      <Tabs
        label="Settimana"
        items={[
          ...(week.start !== weeks[1].start && week.start !== weeks[2].start ? [{ id: "shown", label: weekRangeText(week.start) }] : []),
          { id: "current", label: WEEK_LABELS.current },
          { id: "next", label: WEEK_LABELS.next },
        ]}
        value={week.start === weeks[1].start ? "current" : week.start === weeks[2].start ? "next" : "shown"}
        onChange={(id) => {
          if (id !== "shown") onWeek(id);
        }}
      />

      {!proposal.active ? (
        <div className={ui.row}>
          {fullPropose ? <Button onClick={proposal.start}>Proponi la settimana</Button> : null}
          <MoreActions items={pageActions} />
        </div>
      ) : null}
      {unavailableText && nothingAhead && !weekEmpty && !proposal.active ? <p className={ui.hint}>{unavailableText}</p> : null}
      {proposal.active ? (
        <ProposalCard view={proposal} weekDates={dates} today={data.today} structureMeals={plan.structure?.meals.map((m) => m.kind)} onUse={() => void applyProposal()} busy={using} />
      ) : null}

      {!declaredReady ? (
        <p className={ui.hint} role="status">
          Leggo allergeni ed esclusioni per controllare la settimana…
        </p>
      ) : null}
      {declarations && !declarations.complete ? <IncompleteDeclarations /> : null}
      {violations.length > 0 ? (
        <div className={styles.alert} role="alert">
          <strong>Nel piano c&apos;è qualcosa che hai escluso</strong>
          <ul className={styles.alertList}>
            {violations.map((v, i) => (
              <li key={i}>
                {dayMonth(v.date)}: {v.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {unverified.length > 0 ? (
        <div className={styles.alert}>
          <strong>Non ho potuto controllare tutto</strong>
          <ul className={styles.alertList}>
            {unverified.map((v, i) => (
              <li key={i}>
                {dayMonth(v.date)}: {v.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {confirmedItems.length > 0 ? (
        <div className={styles.alert}>
          <strong>Confermato da te</strong>
          <ul className={styles.alertList}>
            {confirmedItems.map((v, i) => (
              <li key={i}>
                {dayMonth(v.date)}: {v.text}
              </li>
            ))}
          </ul>
          <p className={ui.hint}>
            <Link href={`${DIET_HREF}?sezione=conferme`} className={ui.textLink}>
              Le conferme si ritirano in Alimentazione.
            </Link>
          </p>
        </div>
      ) : null}
      {violations.length + unverified.length + confirmedItems.length > 0 ? <p className={ui.hint}>{ALLERGEN_CHECK_NOTICE}</p> : null}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}

      {weekEmpty && !proposal.active ? (
        <div className={ui.empty}>
          <h3 className={ui.emptyTitle}>Niente di pianificato</h3>
          <p className={ui.emptyText}>Metti i pasti nei giorni: li ritrovi qui e in Oggi, e la spesa sa che cosa serve.</p>
          {unavailableText ? <p className={ui.hint}>{unavailableText}</p> : null}
          {canPropose ? <Button onClick={proposal.start}>Proponi la settimana</Button> : null}
          <Button variant={canPropose ? "outline" : "primary"} onClick={() => setSheet({ type: "add", date: firstDay })}>
            Aggiungi un pasto
          </Button>
        </div>
      ) : null}

      <div className={styles.daysArea}>
        {pastDates.length > 0 ? (
          <Disclosure title="Giorni passati" summary={pastSummary} open={pastOpen} onOpenChange={setPastOpen}>
            <ol className={styles.days}>{pastDates.map(daySection)}</ol>
          </Disclosure>
        ) : null}
        <ol className={styles.days} id="giorni">
          {dates.filter((d) => !pastDates.includes(d)).map(daySection)}
        </ol>
      </div>

      <div id="verifica" className={styles.verifyAnchor}>
        <Disclosure title="Verifica del piano" summary={verifySummary(check)} open={verifyOpen} onOpenChange={setVerifyOpen}>
          {verifyOpen ? <VerifyBody data={data} initialWeek={verifyWeek} /> : null}
        </Disclosure>
      </div>

      {sheet?.type === "add" ? (
        <AddEntrySheet data={data} date={sheet.date} weekStart={week.start} entries={entries} meals={mealOrder} structureMeals={structureMeals} onClose={close} />
      ) : null}

      {sheet?.type === "item" ? (
        <ItemSheet
          data={data}
          entry={sheet.item.entry}
          entryRef={sheet.item.ref}
          weekStart={week.start}
          nextWeekStart={nextStart}
          entries={entries}
          eatShown={itemCommand(sheet.item.entry.item, sheet.item.entry.date, data.today, true) === "eat"}
          onClose={close}
        />
      ) : null}

      {sheet?.type === "eat" ? <EatSheet data={data} entry={sheet.entry} onClose={close} /> : null}

      {sheet?.type === "copyDay" ? (
        <CopyDaySheet
          from={sheet.date}
          today={data.today}
          weeks={weeks}
          onClose={close}
          onCopy={(to) => {
            const from = sheet.date;
            const sourceStart = weekStartOf(from);
            const targetStart = weekStartOf(to);
            return edit(
              (read, ctx) => {
                const source = read(sourceStart);
                if (!source.some((e) => e.date === from)) return { ok: false, error: "Questo giorno non ha più pasti da copiare." };
                return buildWeek(targetStart, copyDay(source, read(targetStart), from, to), ctx, `Copiato il ${dayMonth(from)} sul ${dayMonth(to)}.`);
              },
              { beforeNotice: close },
            );
          }}
        />
      ) : null}

      {sheet?.type === "copyWeek" ? <CopyWeekSheet data={data} target={week} onClose={close} /> : null}

      {sheet?.type === "dayType" ? (
        <DayTypeSheet
          date={sheet.date}
          data={data}
          onClose={close}
          onSet={(name) => write((ctx) => buildDayType(sheet.date, name, ctx), { beforeNotice: close })}
          onClear={async () => {
            const date = sheet.date;
            // l'evento che dà il tipo a questo giorno si rilegge dall'archivio
            let current;
            try {
              current = derivePlan(await getAllEvents()).dayTypes.find((d) => d.date === date);
            } catch {
              return "Non sono riuscito a leggere i dati del telefono. Riprova.";
            }
            if (!current) {
              close();
              return null;
            }
            const eventId = current.eventId;
            return write((ctx) => buildClearDayType(eventId, date, ctx), { beforeNotice: close });
          }}
        />
      ) : null}
    </div>
  );
}
