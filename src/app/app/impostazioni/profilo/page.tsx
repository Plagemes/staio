import type { Metadata } from "next";
import { ProfileForm } from "@/features/nutrition/ProfileForm";

export const metadata: Metadata = { title: "Profilo" };

export default function ProfiloPage() {
  return <ProfileForm />;
}
