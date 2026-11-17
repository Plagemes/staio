import type { Metadata } from "next";
import { Suspense } from "react";
import { CookNow } from "@/features/recipes/CookNow";

export const metadata: Metadata = { title: "Registra il pasto" };

export default function Page() {
  return (
    <Suspense>
      <CookNow />
    </Suspense>
  );
}
