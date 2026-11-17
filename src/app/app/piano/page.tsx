import type { Metadata } from "next";
import { PlanHome } from "@/features/plan/PlanHome";

export const metadata: Metadata = { title: "Piano" };

export default function PianoPage() {
  return <PlanHome />;
}
