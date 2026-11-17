"use client";

import { useSyncExternalStore } from "react";
import { readOnboarding, readOnboardingRaw, subscribeOnboarding } from "../onboarding";
import { EmptyState } from "./EmptyState";

const readOnServer = () => undefined;

/**
 * Oggi senza alcun dato: una scheda sola con la prossima cosa da fare. Segue dove si è scelto di cominciare
 * nel percorso d'ingresso (di base, ciò che si ha in casa). Chi la mostra la toglie appena c'è un dato.
 */
export function FirstStepToday() {
  const raw = useSyncExternalStore<string | null | undefined>(subscribeOnboarding, readOnboardingRaw, readOnServer);
  const meal = raw !== undefined && readOnboarding().start === "meal";
  return meal ? (
    <EmptyState
      title="Segna il primo pasto"
      text="Scrivi cosa hai mangiato: qui compariranno i pasti del giorno e i nutrienti."
      actionLabel="Registra pasto"
      actionHref="/app/pasto"
      secondaryLabel="Aggiungi alla dispensa ciò che hai in casa"
      secondaryHref="/app/cattura/veloce"
    />
  ) : (
    <EmptyState
      title="Comincia da ciò che hai in casa"
      text="Segna i primi alimenti: qui vedrai cosa scade e cosa mangiare prima."
      actionLabel="Aggiungi alla dispensa"
      actionHref="/app/cattura/veloce"
      secondaryLabel="Oppure registra un pasto"
      secondaryHref="/app/pasto"
    />
  );
}
