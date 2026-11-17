import type { Metadata } from "next";
import { Health } from "@/features/health/Health";

export const metadata: Metadata = { title: "Salute" };

export default function SalutePage() {
  return <Health />;
}
