import type { Metadata } from "next";
import { Goals } from "@/features/plan/Goals";

export const metadata: Metadata = { title: "Obiettivi e struttura" };

export default function ObiettiviPage() {
  return <Goals />;
}
