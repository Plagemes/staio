import type { Metadata } from "next";
import { KnownProducts } from "@/features/quality";

export const metadata: Metadata = { title: "Prodotti che conosci" };

export default function Page() {
  return <KnownProducts />;
}
