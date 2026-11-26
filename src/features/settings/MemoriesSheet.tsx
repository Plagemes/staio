"use client";

import { useState, type ReactElement } from "react";
import { Button } from "@/design";
import { Disclosure, Sheet } from "../common";
import { useNotice } from "../notice";
import ui from "../ui.module.css";
import { FORGOT_ALL_TEXT, countText, forgotText } from "./memories";
import { forgetMemories, restoreMemories, useMemories } from "./memoriesStore";
import styles from "./Settings.module.css";

/**
 * Foglio «Memorie»: che cosa l'app ricorda per far fare prima, e «Dimentica» per ognuna. Dimenticare non tocca ciò che hai
 * registrato né ciò che hai scritto apposta (dichiarazioni, profilo, liste): l'elenco è in `memories.ts`.
 * Scrittura, chiusura del foglio, poi l'avviso con «Annulla».
 */
export function MemoriesSheet({ onClose }: { onClose: () => void }): ReactElement {
  const { memories, error: readFailed } = useMemories();
  const notice = useNotice();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function forget(ids: readonly string[] | "all", message: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const rows = await forgetMemories(ids);
      onClose();
      // se nel frattempo non c'era più niente da togliere, niente è cambiato e non c'è niente da annullare
      if (rows.length > 0) notice.show({ message, onUndo: () => restoreMemories(rows) });
    } catch {
      setError("Non sono riuscito a dimenticare. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Memorie" onClose={onClose} busy={busy}>
      <div className={ui.screen}>
        <p className={ui.lead}>Che cosa ricordo per farti fare prima.</p>
        <Disclosure title="Che cosa significa" quiet>
          Dimenticarle non tocca ciò che hai registrato.
        </Disclosure>
        {readFailed ? (
          <p className={ui.error} role="alert">
            Non riesco a leggere ciò che ricordo. Chiudi e riapri l&apos;app.
          </p>
        ) : memories === undefined ? (
          <p className={ui.paragraph} role="status">
            Leggo…
          </p>
        ) : memories.length === 0 ? (
          <p className={ui.paragraph}>Non ricordo ancora niente.</p>
        ) : (
          <>
            <ul className={styles.memories}>
              {memories.map((m) => (
                <li key={m.id} className={styles.memory}>
                  <div className={styles.memoryHead}>
                    <span className={styles.memoryName}>{m.label}</span>
                    <span className={styles.memoryCount}>{countText(m.count)}</span>
                  </div>
                  <p className={ui.hint}>{m.hint}</p>
                  <Button variant="text" disabled={busy} aria-label={`Dimentica: ${m.label}`} onClick={() => void forget([m.id], forgotText(m.label))}>
                    Dimentica
                  </Button>
                </li>
              ))}
            </ul>
            <hr className={styles.memoryRule} />
            <div>
              <button type="button" className={ui.danger} disabled={busy} onClick={() => void forget("all", FORGOT_ALL_TEXT)}>
                Dimentica tutto
              </button>
            </div>
          </>
        )}
        {error ? (
          <p className={ui.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
