import type { Metadata } from "next";
import { Stock } from "@/features/shopping/Stock";

export const metadata: Metadata = { title: "Scorte minime" };

export default function ScortePage() {
  return <Stock />;
}
