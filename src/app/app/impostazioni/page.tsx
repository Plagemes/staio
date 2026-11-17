import type { Metadata } from "next";
import { Settings } from "@/features/settings/Settings";

export const metadata: Metadata = { title: "Impostazioni" };

export default function ImpostazioniPage() {
  return <Settings />;
}
