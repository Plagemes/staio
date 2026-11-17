import type { Metadata } from "next";
import { Week } from "@/features/plan/Week";

export const metadata: Metadata = { title: "Settimana" };

export default function SettimanaPage() {
  return <Week />;
}
