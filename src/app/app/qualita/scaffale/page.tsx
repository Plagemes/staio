import type { Metadata } from "next";
import { Shelf } from "@/features/quality";

export const metadata: Metadata = { title: "Scaffale" };

export default function Page() {
  return <Shelf />;
}
