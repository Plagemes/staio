import type { Metadata } from "next";
import { Today } from "@/features/today/Today";

export const metadata: Metadata = { title: "Oggi" };

export default function OggiPage() {
  return <Today />;
}
