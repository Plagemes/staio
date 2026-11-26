"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { APP_NAME } from "@/config";
import { useDiary, useEventLog, useSetting, wipeAll } from "@/data";
import { Button, SectionHeader } from "@/design";
import { DIET_HREF, useDietDeclarations } from "../allergens";
import { ActionList, type ActionItem } from "../common";
import { useFormEpoch } from "../common/freshForm";
import { dayOf } from "../format";
import { configIssue } from "../ai/settings";
import { useAiSettings } from "../ai/useAiSettings";
import { currentAge } from "../nutrition/profile";
import { useNutritionProfile } from "../nutrition/useNutrition";
import { useNotifyPrefs } from "../notifications/useNotify";
import { requestOnboardingRedo } from "../onboarding";
import { isConfigured } from "../recipes-video/settings";
import { useVideoService } from "../recipes-video/useVideoService";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { useAppearance } from "./appearance";
import { BackupSheet } from "./BackupSheet";
import { LAST_EXPORT_KEY } from "./backupRecord";
import { MemoriesSheet } from "./MemoriesSheet";
import { totalEntries } from "./memories";
import { useMemories } from "./memoriesStore";
import {
  aiValue,
  appearanceValue,
  backupValue,
  dietValue,
  eventsText,
  habitsValue,
  memoriesValue,
  noticesValue,
  profileValue,
  syncValue,
  videoValue,
} from "./settingsSummary";
import { useSyncStamps } from "./useSyncStamps";

type Wipe = "idle" | "confirm" | "working" | "done";
type SheetName = "backup" | "memories";

/** Una riga con il suo valore attuale; senza valore (non ancora letto, o che non si sa dire) resta solo il nome. */
function row(id: string, label: string, value: string | undefined, rest: Pick<ActionItem, "href" | "onSelect">): ActionItem {
  return { id, label, ...(value !== undefined ? { hint: value } : {}), ...rest };
}

/**
 * Impostazioni: ogni riga dice com'è impostata l'app adesso. I valori si leggono con ganci vivi, non una volta sola:
 * tornando sulla pagina dopo aver cambiato il tema, la riga dice il tema nuovo.
 */
export function Settings() {
  const router = useRouter();
  const log = useEventLog();
  const now = useNow();
  const profile = useNutritionProfile();
  const diet = useDietDeclarations();
  const diary = useDiary();
  const appearance = useAppearance();
  const ai = useAiSettings();
  const video = useVideoService();
  const notices = useNotifyPrefs();
  const syncStamps = useSyncStamps();
  const lastBackup = useSetting<unknown>(LAST_EXPORT_KEY);
  const memories = useMemories();
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const { epoch } = useFormEpoch();
  const today = now === null ? undefined : dayOf(now);
  const profileText =
    !profile.ready || today === undefined
      ? undefined
      : profileValue(profile.profile ? { sex: profile.profile.sex, age: currentAge(profile.profile, today) } : null);

  const person: ActionItem[] = [
    row("profile", "Profilo", profileText, { href: "/app/impostazioni/profilo" }),
    row("diet", "Alimentazione", dietValue(diet.state), { href: DIET_HREF }),
    row("habits", "Pasti abituali", diary.data ? habitsValue(diary.data.habits.length) : undefined, { href: "/app/pasti-abituali" }),
    row("intro", "Rifai l'introduzione", undefined, {
      onSelect: () => {
        requestOnboardingRedo();
        router.push("/app");
      },
    }),
  ];
  const look: ActionItem[] = [row("look", "Aspetto", appearance.ready ? appearanceValue(appearance.choice) : undefined, { href: "/app/impostazioni/aspetto" })];
  const features: ActionItem[] = [
    row("ai", "Intelligenza artificiale", ai.ready ? aiValue(configIssue(ai.settings)) : undefined, { href: "/app/impostazioni/ai" }),
    row("video", "Ricette da video", video.ready ? videoValue(isConfigured(video.service)) : undefined, { href: "/app/impostazioni/video" }),
    row("notices", "Avvisi", notices.prefs && !notices.unavailable ? noticesValue(notices.prefs.enabled) : undefined, { href: "/app/impostazioni/avvisi" }),
  ];
  const data: ActionItem[] = [
    row("activity", "Ultime azioni", undefined, { href: "/app/attivita" }),
    row("sync", "Sincronizzazione", syncStamps && now !== null ? syncValue(syncStamps, now) : undefined, { href: "/app/impostazioni/sincronizzazione" }),
    row("backup", "Copia di sicurezza", !lastBackup.loading && now !== null ? backupValue(lastBackup.data, now) : undefined, { onSelect: () => setSheet("backup") }),
    row("memories", "Memorie", memories.memories ? memoriesValue(totalEntries(memories.memories)) : undefined, { onSelect: () => setSheet("memories") }),
  ];

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Impostazioni</h1>
        <Link href="/app" className={ui.textLink}>
          Torna a Oggi
        </Link>
      </div>

      <section className={ui.section}>
        <SectionHeader label="Persona" />
        <ActionList items={person} />
      </section>

      <section className={ui.section}>
        <SectionHeader label="Aspetto" />
        <ActionList items={look} />
      </section>

      <section className={ui.section}>
        <SectionHeader label="Funzioni" />
        <ActionList items={features} />
      </section>

      <section className={ui.section}>
        <SectionHeader label="Dati" />
        <ActionList items={data} />
      </section>

      <section className={ui.section}>
        <SectionHeader label="Informazioni" />
        <p className={ui.paragraph}>
          {log.data !== undefined ? `${eventsText(log.data.length)} ` : ""}
          {APP_NAME} non dà pareri medici e non sostituisce un medico o un dietista. Le scadenze stimate sono indicative: vale ciò che è scritto sulla confezione.
        </p>
      </section>

      <WipeSection key={epoch} />

      {sheet === "backup" ? <BackupSheet onClose={() => setSheet(null)} /> : null}
      {sheet === "memories" ? <MemoriesSheet onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

/**
 * «Cancella tutti i dati»: conferma a due passi dentro la pagina. Sta dietro una key che cambia a ogni visita: «Fatto: i dati
 * sono stati cancellati» resta solo nella visita in cui è nato.
 */
function WipeSection() {
  const ids = useId();
  const [wipe, setWipe] = useState<Wipe>("idle");
  const [wipeError, setWipeError] = useState(false);

  async function onWipe() {
    setWipe("working");
    setWipeError(false);
    try {
      await wipeAll();
      setWipe("done");
    } catch {
      setWipeError(true);
      setWipe("confirm");
    }
  }

  return (
    <section className={ui.section}>
      <SectionHeader label="Cancella tutto" />
      {wipe === "idle" ? (
        <div className={ui.row}>
          <button type="button" className={ui.danger} onClick={() => setWipe("confirm")}>
            Cancella tutti i dati
          </button>
        </div>
      ) : null}

      {wipe === "confirm" || wipe === "working" ? (
        <div className={ui.calloutStrong} role="group" aria-labelledby={`${ids}-wipe`}>
          <p className={ui.paragraph} id={`${ids}-wipe`}>
            <strong>Vuoi cancellare tutti i dati?</strong> Spariscono dispensa e registro, e non si torna indietro. Se non hai una
            copia, esportala prima.
          </p>
          <div className={ui.row}>
            <button type="button" className={ui.dangerSolid} onClick={() => void onWipe()} disabled={wipe === "working"}>
              {wipe === "working" ? "Cancello…" : "Sì, cancella tutto"}
            </button>
            <Button variant="outline" onClick={() => setWipe("idle")} disabled={wipe === "working"}>
              No, tieni i dati
            </Button>
          </div>
          {wipeError ? (
            <p className={ui.error} role="alert">
              Non sono riuscito a cancellare. Riprova.
            </p>
          ) : null}
        </div>
      ) : null}

      {wipe === "done" ? (
        <p className={ui.paragraph} role="status">
          Fatto: i dati sono stati cancellati da questo telefono.
        </p>
      ) : null}
    </section>
  );
}
