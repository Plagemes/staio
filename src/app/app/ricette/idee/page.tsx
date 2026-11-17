import type { Metadata } from "next";
import { RecipeIdeas } from "@/features/ai-capture/RecipeIdeas";

export const metadata: Metadata = { title: "Idee di ricette" };

export default function Page() {
  return <RecipeIdeas />;
}
