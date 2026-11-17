import type { Metadata } from "next";
import { QuickAdd } from "@/features/quick/QuickAdd";

export const metadata: Metadata = { title: "Ho già in casa" };

export default function VelocePage() {
  return <QuickAdd />;
}
