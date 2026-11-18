import type { Metadata } from "next";
import { Activity } from "@/features/activity/Activity";

export const metadata: Metadata = { title: "Ultime azioni" };

export default function AttivitaPage() {
  return <Activity />;
}
