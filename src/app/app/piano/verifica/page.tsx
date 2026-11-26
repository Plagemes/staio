import type { Metadata } from "next";
import { Verify } from "@/features/plan/VerifyScreen";

export const metadata: Metadata = { title: "Settimana" };

export default function VerificaPage() {
  return <Verify />;
}
