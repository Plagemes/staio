import type { Metadata } from "next";
import { Shopping } from "@/features/shopping/Shopping";

export const metadata: Metadata = { title: "Lista della spesa" };

export default function SpesaPage() {
  return <Shopping />;
}
