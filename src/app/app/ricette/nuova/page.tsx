import type { Metadata } from "next";
import { Suspense } from "react";
import { NewRecipe } from "@/features/recipes/NewRecipe";

export const metadata: Metadata = { title: "Nuova ricetta" };

export default function Page() {
  return (
    <Suspense>
      <NewRecipe />
    </Suspense>
  );
}
