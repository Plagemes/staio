import type { Metadata } from "next";
import { QuickAdd } from "@/features/quick/QuickAdd";

export const metadata: Metadata = { title: "Più alimenti" };

export default function VelocePage() {
  return <QuickAdd />;
}
