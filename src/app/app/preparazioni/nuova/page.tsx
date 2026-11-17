import type { Metadata } from "next";
import { Suspense } from "react";
import { NewPrep } from "@/features/prep/NewPrep";

export const metadata: Metadata = { title: "Nuova preparazione" };

export default function Page() {
  return (
    <Suspense>
      <NewPrep />
    </Suspense>
  );
}
