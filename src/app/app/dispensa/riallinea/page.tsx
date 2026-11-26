import type { Metadata } from "next";
import { Realign } from "@/features/realign/Realign";

export const metadata: Metadata = { title: "Controlla le quantità" };

export default function RiallineaPage() {
  return <Realign />;
}
