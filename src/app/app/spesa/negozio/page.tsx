import type { Metadata } from "next";
import { Store } from "@/features/shopping/Store";

export const metadata: Metadata = { title: "In negozio" };

export default function NegozioPage() {
  return <Store />;
}
