import type { Metadata } from "next";
import { AiSettingsScreen } from "@/features/ai/AiSettings";

export const metadata: Metadata = { title: "Intelligenza artificiale" };

export default function AiSettingsPage() {
  return <AiSettingsScreen />;
}
