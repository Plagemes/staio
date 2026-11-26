import type { Metadata } from "next";
import { Suspense } from "react";
import { RecipeIdeas } from "@/features/ai-capture/RecipeIdeas";

export const metadata: Metadata = { title: "Cosa cucinare" };

export default function Page() {
  return (
    <Suspense>
      <RecipeIdeas />
    </Suspense>
  );
}
