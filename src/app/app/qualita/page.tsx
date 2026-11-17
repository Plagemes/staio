import type { Metadata } from "next";
import { Quality } from "@/features/quality";

export const metadata: Metadata = { title: "Qualità" };

export default function QualitaPage() {
  return <Quality />;
}
