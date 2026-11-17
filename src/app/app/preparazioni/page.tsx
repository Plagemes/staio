import type { Metadata } from "next";
import { Preps } from "@/features/prep/Preps";

export const metadata: Metadata = { title: "Preparazioni" };

export default function Page() {
  return <Preps />;
}
