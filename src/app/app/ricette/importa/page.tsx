import type { Metadata } from "next";
import { Import } from "@/features/recipes/Import";

export const metadata: Metadata = { title: "Importa una ricetta" };

export default function Page() {
  return <Import />;
}
