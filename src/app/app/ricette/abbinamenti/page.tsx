import type { Metadata } from "next";
import { Suspense } from "react";
import { Pairings } from "@/features/taste/Pairings";

export const metadata: Metadata = { title: "Abbinamenti di gusto" };

export default function Page() {
  return (
    <Suspense>
      <Pairings />
    </Suspense>
  );
}
