import type { Metadata } from "next";
import { Realign } from "@/features/realign/Realign";

export const metadata: Metadata = { title: "Riallinea la dispensa" };

export default function RiallineaPage() {
  return <Realign />;
}
