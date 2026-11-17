import type { Metadata } from "next";
import { Suspense } from "react";
import { Capture } from "@/features/capture/Capture";

export const metadata: Metadata = { title: "Aggiungi alla dispensa" };

export default function CatturaPage() {
  // il modulo legge i parametri dell'indirizzo (dati dal codice a barre)
  return (
    <Suspense>
      <Capture />
    </Suspense>
  );
}
