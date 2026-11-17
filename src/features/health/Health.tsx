"use client";

import Link from "next/link";
import { useDiary } from "@/data";
import { Label, PromptCard, SectionHeader } from "@/design";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { DrinksCard, SupplementsCard } from "./IntakeCards";
import { MoodCard, SymptomsCard } from "./ScoreCards";
import { WaterCard } from "./WaterCard";
import { WeightCard } from "./WeightCard";

export function Health() {
  const diary = useDiary();
  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Salute</h1>
        <Label>Diario</Label>
      </div>
      <p className={ui.lead}>
        Quello che scrivi tu, giorno per giorno. Staio non dà pareri medici: dove i dati sono pochi, lo dice invece di disegnare
        tendenze.
      </p>

      {diary.error ? <StorageError /> : null}
      {diary.loading ? <LoadingLine /> : null}

      {diary.data ? (
        <>
          <section className={ui.section}>
            <SectionHeader label="Acqua" />
            <WaterCard />
          </section>
          <section className={ui.section}>
            <SectionHeader label="Umore" />
            <MoodCard />
          </section>
          <section className={ui.section}>
            <SectionHeader label="Digestione, energia, sonno" />
            <SymptomsCard />
          </section>
          <section className={ui.section}>
            <SectionHeader label="Peso" />
            <WeightCard />
          </section>
          <section className={ui.section}>
            <SectionHeader label="Integratori" />
            <SupplementsCard />
          </section>
          <section className={ui.section}>
            <SectionHeader label="Caffeina e alcol" />
            <DrinksCard />
          </section>
          <PromptCard title="Nutrizione" description="Medie e confronto con i valori di riferimento, giorno per giorno" href="/app/salute/nutrizione" />
          <Link href="/app/pasto" className={ui.textLink}>
            Registra un pasto
          </Link>
        </>
      ) : null}
    </div>
  );
}
