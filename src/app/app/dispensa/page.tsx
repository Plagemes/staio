import type { Metadata } from "next";
import { Pantry } from "@/features/pantry/Pantry";

export const metadata: Metadata = { title: "Dispensa" };

export default function DispensaPage() {
  return <Pantry />;
}
