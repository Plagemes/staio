import type { Metadata } from "next";
import { PantryPhoto } from "@/features/ai/PantryPhoto";

export const metadata: Metadata = { title: "Foto della dispensa" };

export default function PantryPhotoPage() {
  return <PantryPhoto />;
}
