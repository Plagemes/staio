import type { Metadata } from "next";
import { Capture } from "@/features/capture/Capture";

export const metadata: Metadata = { title: "Cattura" };

export default function CatturaPage() {
  return <Capture />;
}
