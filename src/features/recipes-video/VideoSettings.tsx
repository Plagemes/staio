"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { APP_NAME } from "@/config";
import { Button, SectionHeader } from "@/design";
import { maskKey } from "../ai/settings";
import ui from "../ui.module.css";
import { checkService } from "./serviceClient";
import {
  TOKEN_ERRORS,
  URL_ERRORS,
  checkServiceUrl,
  clearVideoService,
  isConfigured,
  saveVideoService,
  serviceHost,
  tokenToSave,
  videoServiceStore,
  type VideoServiceSettings,
} from "./settings";
import { useVideoService } from "./useVideoService";
import styles from "./videoRecipes.module.css";

type Status = { kind: "ok" | "error"; text: string } | null;

export function VideoSettingsScreen() {
  const { service, ready } = useVideoService();
  if (!ready) {
    return (
      <div className={ui.screen}>
        <div className={ui.head}>
          <h1 className={ui.title}>Lettura dei video</h1>
        </div>
        <p className={ui.lead} role="status">
          Carico le impostazioni…
        </p>
      </div>
    );
  }
  // il modulo parte dai valori salvati e poi è dell'utente: ciò che si digita non si perde se il salvataggio aggiorna `service`
  return <VideoSettingsForm service={service} />;
}

function VideoSettingsForm({ service }: { service: VideoServiceSettings }) {
  const ids = useId();
  const [url, setUrl] = useState(service.url);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState<"saving" | "testing" | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const configured = isConfigured(service);
  const typedHost = (() => {
    const check = checkServiceUrl(url);
    return check.ok ? serviceHost(check.url) : "";
  })();

  async function save(): Promise<boolean> {
    const check = checkServiceUrl(url);
    if (!check.ok) {
      setStatus({ kind: "error", text: URL_ERRORS[check.error] });
      return false;
    }
    const nextToken = tokenToSave(service, url, token);
    if (nextToken === "" && token.trim() === "" && service.token !== "") {
      setStatus({ kind: "error", text: "Hai cambiato il dominio del servizio: per non inviare il vecchio token a un altro servizio l'ho scartato. Incolla il token del nuovo." });
      return false;
    }
    if (nextToken.trim() === "") {
      setStatus({ kind: "error", text: TOKEN_ERRORS.empty });
      return false;
    }
    try {
      const saved = await saveVideoService(videoServiceStore(), { url, token: nextToken });
      if (!saved.ok) {
        setStatus({ kind: "error", text: saved.error });
        return false;
      }
      setToken("");
      setUrl(saved.settings.url);
      return true;
    } catch {
      setStatus({ kind: "error", text: "Non sono riuscito a salvare sul telefono. Riprova." });
      return false;
    }
  }

  async function onSave() {
    if (busy) return;
    setStatus(null);
    setBusy("saving");
    try {
      if (await save()) setStatus({ kind: "ok", text: "Impostazioni salvate su questo telefono." });
    } finally {
      setBusy(null);
    }
  }

  async function onTest() {
    if (busy) return;
    setStatus(null);
    const check = checkServiceUrl(url);
    if (!check.ok) {
      setStatus({ kind: "error", text: URL_ERRORS[check.error] });
      return;
    }
    setBusy("testing");
    try {
      const result = await checkService({ url: check.url }, { fetch: (input, init) => fetch(input, init) });
      setStatus({ kind: result.ok ? "ok" : "error", text: result.message });
    } finally {
      setBusy(null);
    }
  }

  async function onClear() {
    setConfirmClear(false);
    setStatus(null);
    try {
      await clearVideoService(videoServiceStore());
      setUrl("");
      setToken("");
      setStatus({ kind: "ok", text: "Servizio e token cancellati da questo telefono." });
    } catch {
      setStatus({ kind: "error", text: "Non sono riuscito a cancellare. Riprova." });
    }
  }

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Lettura dei video</h1>
        <Link href="/app/impostazioni" className={ui.textLink}>
          Torna alle impostazioni
        </Link>
      </div>

      <section className={ui.section} aria-labelledby={`${ids}-why`}>
        <SectionHeader label="A cosa serve" />
        <div className={styles.block}>
          <p className={ui.paragraph} id={`${ids}-why`}>
            Se condividi con {APP_NAME} un video di ricette (Instagram, TikTok, YouTube), un servizio di estrazione può scaricarlo,
            prenderne la didascalia e alcune immagini. Poi il telefono li legge con la tua chiave di intelligenza artificiale e ti
            propone una bozza di ricetta, che rivedi prima di salvarla.
          </p>
          <ul className={ui.bullets}>
            <li className={ui.paragraph}>
              <strong>È facoltativo, e per ora il servizio non è attivo.</strong> Senza, puoi sempre incollare la didascalia del video.
            </li>
            <li className={ui.paragraph}>
              <strong>Indirizzo e token restano su questo telefono.</strong> Non vanno nelle copie di sicurezza e li cancelli quando
              vuoi.
            </li>
            <li className={ui.paragraph}>
              <strong>Il servizio riceve solo il link del video.</strong> La tua chiave dell&apos;intelligenza artificiale non gli viene
              mai inviata: la usa solo il telefono, verso il fornitore che hai scelto.
            </li>
            <li className={ui.paragraph}>
              <strong>La lettura ha un costo.</strong> Le immagini passano al fornitore: lo paghi tu e conta nel tetto di spesa che hai
              fissato nelle{" "}
              <Link href="/app/impostazioni/ai" className={styles.link}>
                impostazioni dell&apos;intelligenza artificiale
              </Link>
              .
            </li>
            <li className={ui.paragraph}>
              <strong>Uso personale.</strong> Il video non si conserva e la ricetta resta sul tuo telefono, con il link come fonte.
            </li>
          </ul>
        </div>
      </section>

      <section className={ui.section} aria-labelledby={`${ids}-service`}>
        <SectionHeader label="Servizio di estrazione" />
        <div className={styles.block}>
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-url`} id={`${ids}-service`}>
              Indirizzo del servizio
            </label>
            <input
              id={`${ids}-url`}
              className={ui.input}
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <p className={ui.hint}>
              I link dei video e il token andranno solo a: <strong className={styles.mono}>{typedHost || "(indirizzo non valido o vuoto)"}</strong>.
            </p>
          </div>

          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-token`}>
              Token
            </label>
            {configured ? (
              <p className={ui.hint} role="status">
                Token salvato su questo telefono: <span className={styles.mono}>{maskKey(service.token)}</span>. Per cambiarlo, scrivine uno nuovo.
              </p>
            ) : (
              <p className={ui.hint}>Nessun servizio impostato: la lettura dei video è spenta.</p>
            )}
            <div className={styles.keyRow}>
              <input
                id={`${ids}-token`}
                className={ui.input}
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={configured ? "Nuovo token (facoltativo)" : "Incolla il token"}
              />
              <Button variant="outline" onClick={() => setShowToken((v) => !v)} aria-pressed={showToken}>
                {showToken ? "Nascondi" : "Mostra"}
              </Button>
            </div>
          </div>

          <div className={ui.row}>
            <Button onClick={() => void onSave()} disabled={busy !== null}>
              {busy === "saving" ? "Salvo…" : "Salva"}
            </Button>
            <Button variant="outline" onClick={() => void onTest()} disabled={busy !== null}>
              {busy === "testing" ? "Provo…" : "Prova il collegamento"}
            </Button>
          </div>
          <p className={ui.hint}>«Prova il collegamento» chiede solo se il servizio risponde: non invia né il token né alcun link.</p>
          {status ? (
            <p className={status.kind === "error" ? ui.error : ui.hint} role={status.kind === "error" ? "alert" : "status"}>
              {status.text}
            </p>
          ) : null}

          {configured || url.trim() !== "" ? (
            confirmClear ? (
              <div className={ui.calloutStrong} role="group" aria-label="Conferma cancellazione">
                <p className={ui.paragraph}>
                  <strong>Cancello indirizzo e token?</strong> Spariscono da questo telefono e la lettura dei video si spegne.
                </p>
                <div className={ui.row}>
                  <button type="button" className={ui.dangerSolid} onClick={() => void onClear()}>
                    Sì, cancella
                  </button>
                  <Button variant="text" onClick={() => setConfirmClear(false)}>
                    No, tienili
                  </Button>
                </div>
              </div>
            ) : (
              <button type="button" className={ui.danger} onClick={() => setConfirmClear(true)}>
                Cancella servizio e token
              </button>
            )
          ) : null}
        </div>
      </section>
    </div>
  );
}
