import type { Metadata } from "next";
import { Suspense } from "react";
import { Pantry } from "@/features/pantry/Pantry";

export const metadata: Metadata = { title: "Dispensa" };

export default function DispensaPage() {
  // La Dispensa legge `?lotto=` dall'indirizzo: serve il confine di Suspense
  return (
    <Suspense>
      <Pantry />
    </Suspense>
  );
}
