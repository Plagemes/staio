import type { Metadata } from "next";
import { Goals } from "@/features/plan/Goals";

export const metadata: Metadata = { title: "Alimentazione" };

export default function ObiettiviPage() {
  return <Goals />;
}
