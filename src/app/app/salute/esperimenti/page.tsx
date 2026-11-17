import type { Metadata } from "next";
import { Experiments } from "@/features/analysis/Experiments";

export const metadata: Metadata = { title: "Esperimenti" };

export default function ExperimentsPage() {
  return <Experiments />;
}
