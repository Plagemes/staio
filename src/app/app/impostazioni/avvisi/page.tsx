import type { Metadata } from "next";
import { NotificationsScreen } from "@/features/notifications/NotificationsScreen";

export const metadata: Metadata = { title: "Avvisi" };

export default function AvvisiPage() {
  return <NotificationsScreen />;
}
