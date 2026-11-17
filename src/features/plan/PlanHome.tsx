"use client";

import Link from "next/link";
import { getWeek } from "@/core/plan";
import { Label, PromptCard } from "@/design";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import { useShoppingData } from "../shopping/useShoppingData";
import ui from "../ui.module.css";
import { weekChoices } from "./dates";
import { catalogStatus } from "./describe";
import styles from "./plan.module.css";

export function PlanHome() {
  const data = useShoppingData();
  const plan = data.plan;
  if (data.error) return <StorageError />;
  if (!data.ready || !plan.plan) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Piano</h1>
        <LoadingLine />
      </div>
    );
  }

  const week = weekChoices(plan.today).find((w) => w.id === "current")!;
  const entries = getWeek(plan.plan, week.start)?.entries ?? [];
  const days = new Set(entries.map((e) => e.date)).size;
  const weekStatus = entries.length === 0 ? "Niente di pianificato questa settimana" : `Questa settimana: ${entries.length} ${entries.length === 1 ? "voce" : "voci"} in ${days} ${days === 1 ? "giorno" : "giorni"}`;

  const items = (data.view?.items.length ?? 0) + (data.view?.noQuantity.length ?? 0);
  const shoppingStatus = data.trip
    ? "Spesa in corso"
    : items === 0
      ? "Niente da comprare per ora"
      : `${items} ${items === 1 ? "voce proposta" : "voci proposte"}, ognuna con la sua ragione`;

  const active = plan.preps.filter((p) => p.status === "active");
  const portions = active.reduce((s, p) => s + p.remaining, 0);
  const prepStatus =
    active.length === 0
      ? catalogStatus(0, "", "", "Nessuna preparazione")
      : `${active.length} ${active.length === 1 ? "preparazione" : "preparazioni"}, ${portions} ${portions === 1 ? "porzione pronta" : "porzioni pronte"}`;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Piano</h1>
        <Label>Intenzioni, non registro</Label>
      </div>
      <p className={ui.lead}>Che cosa vuoi mangiare e che cosa comprare. Il piano non cambia ciò che hai registrato: è un confronto.</p>

      <nav className={styles.doors} aria-label="Sezioni del piano">
        <PromptCard title="Settimana" description={weekStatus} href="/app/piano/settimana" />
        <PromptCard title="Lista della spesa" description={shoppingStatus} href="/app/spesa" />
        <PromptCard title="Ricette" description={catalogStatus(plan.recipes.length, "ricetta salvata", "ricette salvate", "Nessuna ricetta salvata")} href="/app/ricette" />
        <PromptCard title="Preparazioni" description={prepStatus} href="/app/preparazioni" />
      </nav>

      <div className={styles.links}>
        <Link href="/app/piano/obiettivi" className={ui.textLink}>
          Obiettivi e struttura
        </Link>
        <Link href="/app/piano/verifica" className={ui.textLink}>
          Verifica del piano
        </Link>
        <Link href="/app/spesa/scorte" className={ui.textLink}>
          Scorte minime
        </Link>
      </div>
    </div>
  );
}
