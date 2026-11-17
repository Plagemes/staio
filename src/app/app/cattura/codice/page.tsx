import type { Metadata } from "next";
import { BarcodeCapture } from "@/features/barcode/BarcodeCapture";

export const metadata: Metadata = { title: "Codice a barre" };

export default function BarcodePage() {
  return <BarcodeCapture />;
}
