import type { Metadata } from "next";
import { Suspense } from "react";
import { DietWeek } from "@/features/diet/DietWeek";

export const metadata: Metadata = { title: "Qualità di ciò che mangi" };

export default function MangiatoPage() {
  // legge la settimana dall'indirizzo (?settimana=) e l'ancora (#consigli, #come)
  return (
    <Suspense>
      <DietWeek />
    </Suspense>
  );
}
