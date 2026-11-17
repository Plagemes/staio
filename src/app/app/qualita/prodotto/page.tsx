import type { Metadata } from "next";
import { Suspense } from "react";
import { QualityProduct } from "@/features/quality";

export const metadata: Metadata = { title: "Qualità del prodotto" };

export default function Page() {
  // la pagina legge il codice dall'indirizzo
  return (
    <Suspense>
      <QualityProduct />
    </Suspense>
  );
}
