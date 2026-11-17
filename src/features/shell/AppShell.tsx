"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BottomNav, type NavArea } from "@/design";
import { useOnlineStatus } from "@/pwa";
import { NoticeProvider } from "../notice";
import styles from "./AppShell.module.css";

const HREFS = {
  today: "/app",
  pantry: "/app/dispensa",
  capture: "/app/cattura",
  plan: "/app/piano",
  health: "/app/salute",
} as const;

function areaOf(pathname: string): NavArea | "capture" | undefined {
  if (pathname === "/app" || pathname === "/app/" || pathname.startsWith("/app/impostazioni")) return "today";
  if (pathname.startsWith("/app/dispensa")) return "pantry";
  if (pathname.startsWith("/app/cattura")) return "capture";
  if (pathname.startsWith("/app/piano")) return "plan";
  if (pathname.startsWith("/app/salute")) return "health";
  return undefined;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const online = useOnlineStatus();
  return (
    <NoticeProvider>
      <div className={styles.shell}>
        {online ? null : (
          <p className={styles.offline} role="status">
            Senza rete: i dati restano sul telefono
          </p>
        )}
        <main className={styles.main}>{children}</main>
        <div className={styles.nav}>
          <BottomNav current={areaOf(pathname)} hrefs={HREFS} />
        </div>
      </div>
    </NoticeProvider>
  );
}
