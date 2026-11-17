import type { Metadata } from "next";
import { PlatePhoto } from "@/features/ai-capture/PlatePhoto";

export const metadata: Metadata = { title: "Pasto dalla foto" };

export default function Page() {
  return <PlatePhoto />;
}
