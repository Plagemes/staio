import type { Metadata } from "next";
import { Assistant } from "@/features/assistant/Assistant";

export const metadata: Metadata = { title: "Assistente" };

export default function AssistentePage() {
  return <Assistant />;
}
