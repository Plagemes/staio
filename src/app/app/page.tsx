import type { Metadata } from "next";
import { Suspense } from "react";
import { Today } from "@/features/today/Today";

export const metadata: Metadata = { title: "Oggi" };

export default function OggiPage() {
  // Oggi legge `?giorno=` dall'indirizzo: serve il confine di Suspense
  return (
    <Suspense>
      <Today />
    </Suspense>
  );
}
