import type { Metadata } from "next";
import { ReceiptCapture } from "@/features/ai/ReceiptCapture";

export const metadata: Metadata = { title: "Scontrino" };

export default function ReceiptPage() {
  return <ReceiptCapture />;
}
