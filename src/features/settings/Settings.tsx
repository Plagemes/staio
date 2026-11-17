"use client";

import Link from "next/link";
import { useId, useState, type ChangeEvent } from "react";
import { APP_NAME } from "@/config";
import { exportBackup, importBackup, useEventLog, wipeAll } from "@/data";
import { Button, Label, SectionHeader } from "@/design";
import { dayOf } from "../format";
import ui from "../ui.module.css";
import { describeImport } from "./backupMessages";
import styles from "./Settings.module.css";

type Wipe = "idle" | "confirm" | "working" | "done";

export function Settings() {
  const log = useEventLog();
  const ids = useId();
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [wipe, setWipe] = useState<Wipe>("idle");
  const [wipeError, setWipeError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onExport() {
    setBusy(true);
    setExportMessage(null);
    try {
      const backup = await exportBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${APP_NAME.toLowerCase()}-copia-${dayOf(backup.exportedAt)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setExportMessage(`Copia pronta: ${backup.events.length} eventi. Conservala in un posto sicuro.`);
    } catch {
      setExportMessage("Non sono riuscito a preparare la copia. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  async function onImport(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    setImportMessage(null);
    try {
      setImportMessage(describeImport(await importBackup(await file.text())));
    } catch {
      setImportMessage({ ok: false, text: "Non sono riuscito a leggere il file. Riprova." });
    } finally {
      input.value = "";
      setBusy(false);
    }
  }

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

  const count = log.data?.length;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Impostazioni</h1>
        <Link href="/app" className={ui.textLink}>
          Torna a Oggi
        </Link>
      </div>

      <section className={ui.section}>
        <SectionHeader label="I tuoi dati" />
        <div className={styles.block}>
          <p className={ui.paragraph}>
            Tutto resta su questo telefono e funziona anche senza rete. Nessun dato viene inviato altrove.
            {count !== undefined ? ` Eventi registrati: ${count}.` : ""}
          </p>
        </div>
      </section>

      <section className={ui.section}>
        <SectionHeader label="Copia di sicurezza" />
        <div className={styles.block}>
          <p className={ui.paragraph}>
            Esporta una copia di tutto ciò che hai registrato, oppure importane una. Importare non cancella niente: gli eventi
            già presenti restano.
          </p>
          <div className={ui.row}>
            <Button variant="outline" onClick={onExport} disabled={busy}>
              Esporta una copia
            </Button>
            <label className={styles.file}>
              <input type="file" accept="application/json,.json" onChange={onImport} disabled={busy} />
              <span>Importa una copia</span>
            </label>
          </div>
          {exportMessage ? (
            <p className={ui.hint} role="status">
              {exportMessage}
            </p>
          ) : null}
          {importMessage ? (
            <p className={importMessage.ok ? ui.hint : ui.error} role={importMessage.ok ? "status" : "alert"}>
              {importMessage.text}
            </p>
          ) : null}
        </div>
      </section>

      <section className={ui.section}>
        <SectionHeader label="Cancella tutto" />
        <div className={styles.block}>
          {wipe === "idle" ? (
            <>
              <p className={ui.paragraph}>Toglie dal telefono tutti i dati dell&apos;app. Non si può annullare.</p>
              <div className={ui.row}>
                <button type="button" className={ui.danger} onClick={() => setWipe("confirm")}>
                  Cancella tutti i dati
                </button>
              </div>
            </>
          ) : null}

          {wipe === "confirm" || wipe === "working" ? (
            <div className={ui.calloutStrong} role="group" aria-labelledby={`${ids}-wipe`}>
              <p className={ui.paragraph} id={`${ids}-wipe`}>
                <strong>Vuoi cancellare tutti i dati?</strong> Spariscono dispensa e registro, e non si torna indietro. Se non hai
                una copia, esportala prima.
              </p>
              <div className={ui.row}>
                <button type="button" className={ui.dangerSolid} onClick={onWipe} disabled={wipe === "working"}>
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
        </div>
      </section>

      <section className={ui.section}>
        <SectionHeader label="Avviso" />
        <div className={styles.block}>
          <Label>Nessun parere medico</Label>
          <p className={ui.paragraph}>
            {APP_NAME} non dà pareri medici. Confronta ciò che mangi con valori di riferimento e ti dice quanto sono sicure le
            stime, ma non fa diagnosi né sostituisce un medico o un dietista. Le scadenze stimate sono indicative: in caso di
            dubbio, vale ciò che è scritto sulla confezione.
          </p>
        </div>
      </section>
    </div>
  );
}
