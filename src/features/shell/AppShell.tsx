"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { BottomNav, type NavArea } from "@/design";
import { InstallHint, useOnlineStatus } from "@/pwa";
import { NoticeProvider } from "../notice";
import { Onboarding, useOnboardingGate } from "../onboarding";
import { StyleChoice, StyleChoiceBoundary, useStyleChoiceGate } from "../settings/StyleChoice";
import { AddSheet } from "./AddSheet";
import { BarcodeMigration } from "./BarcodeMigration";
import styles from "./AppShell.module.css";

const HREFS = {
  today: "/app",
  pantry: "/app/dispensa",
  capture: "/app/cattura",
  plan: "/app/piano",
  health: "/app/salute",
} as const;

function areaOf(pathname: string): NavArea | "capture" | undefined {
  if (
    pathname === "/app" ||
    pathname === "/app/" ||
    pathname.startsWith("/app/impostazioni") ||
    pathname.startsWith("/app/assistente") ||
    pathname.startsWith("/app/attivita") ||
    pathname.startsWith("/app/pasto") ||
    pathname.startsWith("/app/pasti-abituali")
  )
    return "today";
  if (pathname.startsWith("/app/dispensa")) return "pantry";
  if (pathname.startsWith("/app/cattura")) return "capture";
  if (
    pathname.startsWith("/app/piano") ||
    pathname.startsWith("/app/spesa") ||
    pathname.startsWith("/app/qualita") ||
    pathname.startsWith("/app/ricette") ||
    pathname.startsWith("/app/preparazioni")
  )
    return "plan";
  if (pathname.startsWith("/app/salute")) return "health";
  return undefined;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const online = useOnlineStatus();
  const area = areaOf(pathname);
  const styleChoice = useStyleChoiceGate(pathname);
  const onboarding = useOnboardingGate(pathname);
  const [adding, setAdding] = useState(false);
  // finché si sceglie lo stile o si fa l'introduzione il «+» non apre niente: sotto non c'è ancora l'app
  const canAdd = !styleChoice.show && !onboarding.show;
  return (
    <NoticeProvider>
      <BarcodeMigration />
      {/* data-area: nel tema Vivo l'area corrente dà il colore d'accento a tutta la sezione (themes.css) */}
      <div className={styles.shell} data-area={area}>
        {online ? null : (
          <p className={styles.offline} role="status">
            Senza rete: i dati restano sul telefono
          </p>
        )}
        {/* data-app-content: solo questo resta nascosto, al massimo per un attimo, mentre si decide se proporre la scelta dello stile (tokens.css) */}
        <main className={styles.main} data-app-content="">
          {styleChoice.show ? (
            <StyleChoiceBoundary onError={styleChoice.close} fallback={children}>
              <StyleChoice onDone={styleChoice.close} />
            </StyleChoiceBoundary>
          ) : onboarding.show ? (
            <StyleChoiceBoundary onError={() => onboarding.close()} fallback={children}>
              <Onboarding onDone={onboarding.close} />
            </StyleChoiceBoundary>
          ) : (
            <>
              {pathname === "/app" || pathname === "/app/" ? <InstallHint /> : null}
              {children}
            </>
          )}
        </main>
        <div className={styles.nav}>
          <BottomNav
            current={area}
            hrefs={HREFS}
            onAdd={() => {
              if (canAdd) setAdding(true);
            }}
          />
        </div>
        {adding && canAdd ? <AddSheet onClose={() => setAdding(false)} /> : null}
      </div>
    </NoticeProvider>
  );
}
