"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useRef, useState } from "react";
import { Tabs, type TabItem } from "@/design";
import { IdeasPanel } from "../ai-capture/IdeasPanel";
import { PairingsPanel } from "../taste/PairingsPanel";
import ui from "../ui.module.css";

export type CookStart = "idee" | "abbinamenti";

const TITLE = "Cosa cucinare";
const TABS: TabItem[] = [
  { id: "idee", label: "Idee" },
  { id: "abbinamenti", label: "Con cosa sta bene" },
];

/**
 * «Cosa cucinare»: una pagina, due schede, sui due indirizzi di sempre (`/app/ricette/idee` e `/app/ricette/abbinamenti`). La
 * scheda di partenza dipende dall'indirizzo; i due pannelli restano sempre montati e quello non scelto è nascosto, così
 * una richiesta all'intelligenza artificiale in corso (e la sua risposta pagata) e la scelta degli abbinamenti non si perdono
 * passando da una scheda all'altra.
 */
export function CookIdeas({ start }: { start: CookStart }) {
  return (
    <Suspense
      fallback={
        <div className={ui.screen}>
          <h1 className={ui.title}>{TITLE}</h1>
        </div>
      }
    >
      <CookIdeasBody start={start} />
    </Suspense>
  );
}

function CookIdeasBody({ start }: { start: CookStart }) {
  const address = useSearchParams().toString();
  const [tab, setTab] = useState<CookStart>(start);
  const [seen, setSeen] = useState(address);
  const ids = useId();
  const tabs = useRef<HTMLDivElement>(null);
  // la pagina resta viva tra una visita e l'altra: se l'indirizzo cambia si riparte dalla scheda dell'indirizzo
  if (seen !== address) {
    setSeen(address);
    setTab(start);
  }
  // uscendo dalla pagina (tenuta in vita ma nascosta) la scelta si dimentica: tornando si trova la scheda del collegamento
  useEffect(() => () => setTab(start), [start]);
  // le schede dei componenti comuni non hanno un id: lo si dà qui, così ogni pannello può dire da quale scheda è chiamato
  useEffect(() => {
    tabs.current?.querySelectorAll<HTMLElement>("[role=tab]").forEach((el, i) => {
      const item = TABS[i];
      if (!item) return;
      el.id = `${ids}-tab-${item.id}`;
      el.setAttribute("aria-controls", `${ids}-panel-${item.id}`);
    });
  }, [ids]);

  return (
    <div className={ui.screen}>
      <h1 className={ui.title}>{TITLE}</h1>
      <div ref={tabs}>
        <Tabs label="Cosa cucinare" items={TABS} value={tab} onChange={(id) => setTab(id === "abbinamenti" ? "abbinamenti" : "idee")} />
      </div>
      <div role="tabpanel" id={`${ids}-panel-idee`} aria-labelledby={`${ids}-tab-idee`} hidden={tab !== "idee"}>
        <div className={ui.screen}>
          <IdeasPanel />
        </div>
      </div>
      <div role="tabpanel" id={`${ids}-panel-abbinamenti`} aria-labelledby={`${ids}-tab-abbinamenti`} hidden={tab !== "abbinamenti"}>
        <div className={ui.screen}>
          <PairingsPanel />
        </div>
      </div>
    </div>
  );
}
