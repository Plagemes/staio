"use client";

import Link from "next/link";
import { SectionHeader } from "@/design";
import ui from "../ui.module.css";
import { NoticesList } from "./NoticesList";
import { useTodayNotices } from "./useNotify";

/**
 * Avvisi di oggi dentro l'app, per la schermata Oggi. Non mostra nulla finché i dati non sono
 * pronti e quando non c'è niente da dire: un giorno senza avvisi non ha bisogno di una sezione.
 */
export function TodayNotices({ limit = 4 }: { limit?: number }) {
  const facts = useTodayNotices();
  if (!facts || facts.length === 0) return null;
  return (
    <section className={ui.section} aria-label="Avvisi di oggi">
      <SectionHeader label="Da guardare oggi" actionLabel="Impostazioni" actionHref="/app/impostazioni/avvisi" />
      <NoticesList facts={facts} limit={limit} />
      {facts.length > limit ? (
        <Link href="/app/impostazioni/avvisi" className={ui.textLink}>
          Vedi tutti
        </Link>
      ) : null}
    </section>
  );
}
