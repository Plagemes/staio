import type { Metadata } from "next";
import { Suspense } from "react";
import { PlatePhoto } from "@/features/ai-capture/PlatePhoto";

export const metadata: Metadata = { title: "Pasto dalla foto" };

export default function Page() {
  // legge momento e giorno dall'indirizzo: arrivano dalla riga di Oggi
  return (
    <Suspense>
      <PlatePhoto />
    </Suspense>
  );
}
