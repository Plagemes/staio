"use client";

import { viewNeedsNutrition } from "@/core/views";
import { PromptCard, SectionHeader } from "@/design";
import ui from "../ui.module.css";
import { RunView } from "./GeneratedView";
import { usePinnedViews } from "./pinnedStore";
import { ViewContextGate } from "./ViewContextGate";
import styles from "./assistant.module.css";

export interface PinnedViewsProps {
  /** Se non c'è nessuna vista fissata: mostrare un invito verso l'assistente (predefinito: non mostrare nulla). */
  showEmpty?: boolean;
}

/**
 * Le viste che l'utente ha fissato, ricalcolate sui dati correnti ogni volta che i dati cambiano. Non chiama
 * l'intelligenza artificiale e funziona anche senza chiave. Da montare in Oggi, senza altro.
 */
export function PinnedViews({ showEmpty = false }: PinnedViewsProps) {
  const { views, loading } = usePinnedViews();
  if (loading) return null;
  if (views.length === 0) {
    return showEmpty ? (
      <PromptCard title="Chiedi qualcosa all'assistente" description="Fissa qui le risposte che vuoi tenere d'occhio." href="/app/assistente" />
    ) : null;
  }
  const needsNutrition = views.some((v) => viewNeedsNutrition(v.spec));
  return (
    <section className={styles.today} aria-label="Le tue viste">
      <SectionHeader label="Le tue viste" actionLabel="Assistente" actionHref="/app/assistente" />
      <ViewContextGate needsNutrition={needsNutrition}>
        {(state) =>
          state.status === "ready" ? (
            views.map((v) => <RunView key={v.id} spec={v.spec} ctx={state.ctx} title={v.name} headingLevel={3} />)
          ) : (
            <p className={ui.hint} role="status">
              {state.status === "loading" ? "Un attimo…" : "Non riesco a leggere i dati del telefono."}
            </p>
          )
        }
      </ViewContextGate>
    </section>
  );
}
