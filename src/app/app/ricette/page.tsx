import type { Metadata } from "next";
import { Recipes } from "@/features/recipes/Recipes";

export const metadata: Metadata = { title: "Ricettario" };

export default function Page() {
  return <Recipes />;
}
