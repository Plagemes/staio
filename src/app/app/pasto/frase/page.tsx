import type { Metadata } from "next";
import { Suspense } from "react";
import { MealPhrase } from "@/features/ai-capture/MealPhrase";

export const metadata: Metadata = { title: "Pasto da una frase" };

export default function Page() {
  // legge momento e giorno dall'indirizzo: arrivano dalla riga di Oggi
  return (
    <Suspense>
      <MealPhrase />
    </Suspense>
  );
}
