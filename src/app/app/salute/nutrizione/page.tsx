import type { Metadata } from "next";
import { Nutrition } from "@/features/nutrition/Nutrition";

export const metadata: Metadata = { title: "Nutrizione" };

export default function NutrizionePage() {
  return <Nutrition />;
}
