import type { Metadata } from "next";
import { SyncScreen } from "@/features/sync/SyncScreen";

export const metadata: Metadata = { title: "Sincronizzazione" };

export default function SincronizzazionePage() {
  return <SyncScreen />;
}
