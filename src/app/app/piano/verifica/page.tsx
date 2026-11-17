import type { Metadata } from "next";
import { Verify } from "@/features/plan/VerifyScreen";

export const metadata: Metadata = { title: "Verifica del piano" };

export default function VerificaPage() {
  return <Verify />;
}
