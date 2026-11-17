import type { Metadata } from "next";
import { Report } from "@/features/analysis/Report";

export const metadata: Metadata = { title: "Rapporto" };

export default function ReportPage() {
  return <Report />;
}
