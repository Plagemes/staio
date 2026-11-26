import type { Metadata } from "next";
import { Suspense } from "react";
import { DietScreen } from "@/features/settings/DietScreen";

export const metadata: Metadata = { title: "Alimentazione" };

export default function AlimentazionePage() {
  // La schermata legge `?sezione=` dall'indirizzo: serve il confine di Suspense
  return (
    <Suspense>
      <DietScreen />
    </Suspense>
  );
}
