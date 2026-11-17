import type { Metadata } from "next";
import { Suspense } from "react";
import { Cook } from "@/features/recipes/Cook";

export const metadata: Metadata = { title: "Cucina" };

export default function Page() {
  return (
    <Suspense>
      <Cook />
    </Suspense>
  );
}
