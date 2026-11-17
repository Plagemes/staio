import type { Metadata } from "next";
import { Suspense } from "react";
import { RecipeView } from "@/features/recipes/RecipeView";

export const metadata: Metadata = { title: "Ricetta" };

export default function Page() {
  return (
    <Suspense>
      <RecipeView />
    </Suspense>
  );
}
