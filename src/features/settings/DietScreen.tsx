"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { setSetting, useSetting, usePlan } from "@/data";
import { useDietDeclarations } from "../allergens";
import { Disclosure } from "../common";
import { useFormEpoch } from "../common/freshForm";
import { dayOf } from "../format";
import { DIET_MERGED_NOTICE_KEY } from "../migrations";
import { ConfirmationsSection, StructureSection, TargetsSection, typesWithTargets } from "../plan/Goals";
import { useConfirmations } from "../recipes/useConfirmations";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { DeclarationsSection } from "./DeclarationsSection";
import { parseDietSection, type DietSection } from "./dietSection";
import { confirmationsSummary, structureSummary, targetsSummary } from "./settingsSummary";
import styles from "./Settings.module.css";

/**
 * Impostazioni › Alimentazione (`/app/impostazioni/alimentazione`): legge `?sezione=obiettivi|pasti|conferme` e apre quella
 * riga. La pagina che la monta ci mette il confine di Suspense.
 */
export function DietScreen() {
  const search = useSearchParams();
  return <DietView initial={parseDietSection(search.get("sezione"))} params={search.toString()} />;
}

/**
 * La schermata, con la riga da aprire già decisa. `/app/piano/obiettivi` la monta con «obiettivi» (stessa schermata, niente
 * reindirizzamento). Le righe sono dietro una `key` che cambia a ogni arrivo e con i parametri: la pagina resta viva tra
 * una visita e l'altra e ogni arrivo apre la riga giusta.
 */
export function DietView({ initial, params = "" }: { initial: DietSection | null; params?: string }) {
  const diet = useDietDeclarations();
  const { epoch } = useFormEpoch(params);

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Alimentazione</h1>
        <Link href="/app/impostazioni" className={ui.textLink}>
          Torna alle impostazioni
        </Link>
      </div>
      <MergedNotice key={`avviso|${epoch}`} />

      {/* sempre per prima e aperta: gli allergeni non dipendono da piano né da conferme */}
      {diet.error !== undefined ? (
        <p className={ui.error} role="alert">
          Non riesco a leggere gli allergeni e gli alimenti esclusi. Chiudi e riapri l&apos;app.
        </p>
      ) : diet.state === undefined ? (
        <p className={ui.lead} role="status">
          Leggo ciò che hai indicato…
        </p>
      ) : (
        <DeclarationsSection state={diet.state} />
      )}

      <DietRows key={`righe|${epoch}`} initial={initial} />
    </div>
  );
}

/**
 * La frase sulle voci riunite compare una volta sola, nella visita in cui la migrazione ha finito: resta in vista finché si
 * sta sulla pagina e alla visita dopo non c'è più (dietro la key di ogni visita, perché la pagina resta viva).
 */
function MergedNotice() {
  const merged = useSetting<unknown>(DIET_MERGED_NOTICE_KEY);
  const [show, setShow] = useState(false);
  if (merged.data === false && !show) setShow(true);

  useEffect(() => {
    if (merged.data === false) void setSetting(DIET_MERGED_NOTICE_KEY, true).catch(() => undefined);
  }, [merged.data]);

  return show ? (
    <p className={ui.callout} role="status">
      Ho riunito qui gli allergeni e gli alimenti esclusi che avevi scritto nel ricettario e nel piano.
    </p>
  ) : null;
}

const ROW_ID = (section: DietSection): string => `alimentazione-${section}`;

/** Le tre righe richiuse: una sola aperta alla volta, così un solo pulsante pieno è in vista. */
function DietRows({ initial }: { initial: DietSection | null }) {
  const plan = usePlan();
  const now = useNow();
  const confirmations = useConfirmations();
  const [open, setOpen] = useState<DietSection | null>(initial);
  const scrolled = useRef(false);
  const ready = plan.data !== undefined && now !== null;

  // arrivando con `?sezione=` la riga aperta può stare sotto gli allergeni: si porta in vista, una volta
  useEffect(() => {
    if (!ready || initial === null || scrolled.current) return;
    scrolled.current = true;
    document.getElementById(ROW_ID(initial))?.scrollIntoView?.({ block: "start" });
  }, [ready, initial]);

  if (plan.error) return <StorageError />;
  if (!plan.data || !now) return <LoadingLine />;

  const toggle = (section: DietSection) => (next: boolean) => setOpen(next ? section : null);
  const active = confirmations.state?.active.length;

  return (
    <div className={styles.disclosures}>
      <div id={ROW_ID("obiettivi")}>
        <Disclosure
          title="Obiettivi per tipo di giornata"
          summary={targetsSummary(typesWithTargets(plan.data))}
          open={open === "obiettivi"}
          onOpenChange={toggle("obiettivi")}
        >
          <TargetsSection plan={plan.data} today={dayOf(now)} />
        </Disclosure>
      </div>
      <div id={ROW_ID("pasti")}>
        <Disclosure title="Pasti e orari" summary={structureSummary(plan.data.structure)} open={open === "pasti"} onOpenChange={toggle("pasti")}>
          <StructureSection key={plan.data.structure?.eventId ?? "none"} plan={plan.data} />
        </Disclosure>
      </div>
      <div id={ROW_ID("conferme")}>
        <Disclosure
          title="Ingredienti che hai confermato"
          summary={active === undefined ? undefined : confirmationsSummary(active)}
          open={open === "conferme"}
          onOpenChange={toggle("conferme")}
        >
          <ConfirmationsSection />
        </Disclosure>
      </div>
    </div>
  );
}
