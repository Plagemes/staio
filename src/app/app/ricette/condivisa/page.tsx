import type { Metadata } from "next";
import { Suspense } from "react";
import { SharedRecipe } from "@/features/recipes-video/SharedRecipe";

export const metadata: Metadata = { title: "Condiviso" };

export default function Page() {
  return (
    <Suspense>
      <SharedRecipe />
    </Suspense>
  );
}
