import type { Metadata } from "next";
import { AppearanceScreen } from "@/features/settings/AppearanceScreen";

export const metadata: Metadata = { title: "Aspetto" };

export default function AspettoPage() {
  return <AppearanceScreen />;
}
