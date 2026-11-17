import type { Metadata } from "next";
import { Analysis } from "@/features/analysis/Analysis";

export const metadata: Metadata = { title: "Analisi" };

export default function AnalysisPage() {
  return <Analysis />;
}
