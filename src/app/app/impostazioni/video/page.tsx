import type { Metadata } from "next";
import { VideoSettingsScreen } from "@/features/recipes-video/VideoSettings";

export const metadata: Metadata = { title: "Lettura dei video" };

export default function VideoSettingsPage() {
  return <VideoSettingsScreen />;
}
