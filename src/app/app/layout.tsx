import type { Metadata } from "next";
import type { ReactNode } from "react";
import { APP_NAME } from "@/config";
import { ServiceWorkerRegister } from "@/pwa";
import { NotificationRunner } from "@/features/notifications";
import { ThemeSync } from "@/features/settings/ThemeSync";
import { AppShell } from "@/features/shell/AppShell";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  description: "La tua dispensa, il registro di ciò che entra, si mangia e si butta. I dati restano sul telefono.",
};

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ServiceWorkerRegister />
      <ThemeSync />
      <NotificationRunner />
      <AppShell>{children}</AppShell>
    </>
  );
}
