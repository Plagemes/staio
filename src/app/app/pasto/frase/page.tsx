import type { Metadata } from "next";
import { MealPhrase } from "@/features/ai-capture/MealPhrase";

export const metadata: Metadata = { title: "Pasto da una frase" };

export default function Page() {
  return <MealPhrase />;
}
