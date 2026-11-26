"use client";

import { useState, type ChangeEvent, type ReactElement } from "react";
import { APP_NAME } from "@/config";
import { exportBackup, importBackup, importSettings } from "@/data";
import { Button, SectionHeader } from "@/design";
import { Sheet } from "../common";
import { dayOf } from "../format";
import ui from "../ui.module.css";
import { describeImport, describeSettingsExport, describeSettingsImport } from "./backupMessages";
import { exportSettingsCopy, rememberEventsBackup } from "./backupRecord";
import styles from "./Settings.module.css";

type Message = { ok: boolean; text: string } | null;

function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Foglio «Copie»: la copia di tutto ciò che hai registrato e quella delle impostazioni (senza chiavi né token). Gli esiti
 * stanno dentro il foglio: non sono azioni da annullare.
 */
export function BackupSheet({ onClose }: { onClose: () => void }): ReactElement {
  const [busy, setBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<Message>(null);
  const [settingsMessage, setSettingsMessage] = useState<Message>(null);

  async function onExport() {
    setBusy(true);
    setExportMessage(null);
    try {
      const backup = await exportBackup();
      saveFile(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }), `${APP_NAME.toLowerCase()}-copia-${dayOf(backup.exportedAt)}.json`);
      await rememberEventsBackup();
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

  async function onExportSettings() {
    setBusy(true);
    setSettingsMessage(null);
    try {
      const file = await exportSettingsCopy();
      saveFile(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }), `${APP_NAME.toLowerCase()}-impostazioni-${dayOf(file.exportedAt)}.json`);
      setSettingsMessage({ ok: true, text: describeSettingsExport(Object.keys(file.settings).length) });
    } catch {
      setSettingsMessage({ ok: false, text: "Non sono riuscito a preparare la copia. Riprova." });
    } finally {
      setBusy(false);
    }
  }

  async function onImportSettings(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    setSettingsMessage(null);
    try {
      setSettingsMessage(describeSettingsImport(await importSettings(await file.text())));
    } catch {
      setSettingsMessage({ ok: false, text: "Non sono riuscito a leggere il file. Riprova." });
    } finally {
      input.value = "";
      setBusy(false);
    }
  }

  return (
    <Sheet title="Copie" onClose={onClose} busy={busy}>
      <div className={ui.screen}>
        <section className={styles.sheetBlock}>
          <SectionHeader label="Copia di sicurezza" />
          <p className={ui.paragraph}>Tutto ciò che hai registrato. Importare non cancella niente.</p>
          <div className={ui.row}>
            <Button variant="outline" onClick={() => void onExport()} disabled={busy}>
              Esporta una copia
            </Button>
            <label className={styles.fileText}>
              <input type="file" accept="application/json,.json" onChange={(e) => void onImport(e)} disabled={busy} />
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
        </section>

        <section className={styles.sheetBlock}>
          <SectionHeader label="Copia delle impostazioni" />
          <p className={ui.paragraph}>Profilo, liste e scelte ricordate, senza chiavi né token.</p>
          <div className={ui.row}>
            <Button variant="outline" onClick={() => void onExportSettings()} disabled={busy}>
              Esporta le impostazioni
            </Button>
            <label className={styles.fileText}>
              <input type="file" accept="application/json,.json" onChange={(e) => void onImportSettings(e)} disabled={busy} />
              <span>Importa le impostazioni</span>
            </label>
          </div>
          {settingsMessage ? (
            <p className={settingsMessage.ok ? ui.hint : ui.error} role={settingsMessage.ok ? "status" : "alert"}>
              {settingsMessage.text}
            </p>
          ) : null}
        </section>
      </div>
    </Sheet>
  );
}
