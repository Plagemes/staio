"use client";

import Link from "next/link";
import { useEffect, useId, useState, useSyncExternalStore, type ChangeEvent, type FormEvent } from "react";
import { APP_NAME } from "@/config";
import { SYNC_SCOPE, SyncCryptoError, type KeyInfo, type ReadPackageResult } from "@/core/sync";
import {
  DriveTransport,
  changePassphrase,
  createPassphrase,
  exportSyncPackage,
  clearQuarantine,
  forgetKeys,
  importSyncPackage,
  listRemoteKeyInfos,
  liveSyncOverview,
  readSyncPackage,
  syncWith,
  unlockPackageKeys,
  unlockPassphrase,
  type StoredReport,
  type SyncOverview,
} from "@/data/sync";
import { Button, SectionHeader } from "@/design";
import { Disclosure } from "../common";
import { dayOf } from "../format";
import settingsStyles from "../settings/Settings.module.css";
import ui from "../ui.module.css";
import { exportNotice, passphraseStep, showReadOlderForm } from "./flow";
import {
  driveClientId,
  driveConnected,
  driveTokenProvider,
  forgetDriveToken,
  hasDriveToken,
  requestDriveToken,
  subscribeDriveConnection,
} from "./googleAuth";
import {
  clearQuarantineQuestion,
  clockWarningText,
  describeReport,
  lastOutcome,
  packageErrorText,
  packageReadText,
  passphraseErrorText,
  quarantineReasonText,
  scopeText,
  shortDevice,
  when,
  type Message,
} from "./messages";
import styles from "./SyncScreen.module.css";

type LoadedPackage = Extract<ReadPackageResult, { ok: true }>;

function useOverview(): SyncOverview | undefined {
  const [value, setValue] = useState<SyncOverview>();
  useEffect(() => {
    const sub = liveSyncOverview().subscribe({ next: setValue, error: () => undefined });
    return () => sub.unsubscribe();
  }, []);
  return value;
}

function Notice({ message }: { message: Message | null }) {
  if (!message) return null;
  return (
    <p className={message.ok ? ui.hint : ui.error} role={message.ok ? "status" : "alert"}>
      {message.text}
    </p>
  );
}

function SecretField(props: { id: string; label: string; value: string; onChange: (v: string) => void; disabled: boolean; isNew?: boolean }) {
  return (
    <label className={ui.field} htmlFor={props.id}>
      <span className={ui.fieldLabel}>{props.label}</span>
      <input
        id={props.id}
        className={ui.input}
        type="password"
        autoComplete={props.isNew ? "new-password" : "current-password"}
        autoCapitalize="off"
        spellCheck={false}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
      />
    </label>
  );
}

const neverConnected = () => false;

function unmatchedNote(unmatched: number): string {
  return unmatched > 0
    ? " Attenzione: un altro dispositivo usa una frase diversa, e i suoi dati restano da leggere finché non inserisci anche quella."
    : "";
}

function cryptoCode(e: unknown): string | undefined {
  return e instanceof SyncCryptoError ? e.code : undefined;
}

function download(bytes: Uint8Array, name: string): void {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function SyncScreen() {
  const ids = useId();
  const overview = useOverview();
  const driveReady = Boolean(driveClientId());
  const connected = useSyncExternalStore(subscribeDriveConnection, driveConnected, neverConnected);
  const [remoteKeys, setRemoteKeys] = useState<KeyInfo[] | null>(null);
  const [driveSkipped, setDriveSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [driveMessage, setDriveMessage] = useState<Message | null>(null);
  const [keyMessage, setKeyMessage] = useState<Message | null>(null);
  const [fileMessage, setFileMessage] = useState<Message | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [changing, setChanging] = useState(false);
  const [currentPhrase, setCurrentPhrase] = useState("");
  const [confirmForget, setConfirmForget] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [olderPhrase, setOlderPhrase] = useState("");
  const [quarantineMessage, setQuarantineMessage] = useState<Message | null>(null);
  /** Esito "chiave diversa" già risolto con lo sblocco: non lo si ripropone finché non arriva un giro nuovo. */
  const [resolvedReport, setResolvedReport] = useState<string | null>(null);
  const [encryptFile, setEncryptFile] = useState(true);
  const [lockedPackage, setLockedPackage] = useState<LoadedPackage | null>(null);
  const [packagePhrase, setPackagePhrase] = useState("");

  const keysReady = overview?.keys.ready ?? false;
  const driveReport = overview?.drive;
  const remoteMismatch = driveReport?.error === "key_mismatch" && resolvedReport !== driveReport.finishedAt;
  const knownRemote = connected ? remoteKeys : null;
  const step = passphraseStep({
    driveReady,
    driveSkipped,
    remoteKeys: knownRemote?.length ?? null,
    remoteMismatch,
    localKeys: overview?.keys.keyIds.length ?? 0,
    keysReady,
  });
  const reports = [overview?.drive, overview?.file].filter((r): r is StoredReport => r !== undefined);
  const latest = [...reports].sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : -1))[0];
  const clock = latest?.clock ?? [];

  const transport = () => new DriveTransport({ getToken: driveTokenProvider });

  function clearPhrases() {
    setOlderPhrase("");
    setPassphrase("");
    setConfirmation("");
    setCurrentPhrase("");
  }

  /** Chiavi su Drive lette adesso, se collegati: la frase si verifica sempre contro quelle. */
  async function freshRemoteKeys(): Promise<KeyInfo[]> {
    if (!connected) return [];
    const infos = await listRemoteKeyInfos(transport());
    setRemoteKeys(infos);
    return infos;
  }

  async function onConnect() {
    setDriveMessage(null);
    setKeyMessage(null);
    setBusy(true);
    try {
      if (!hasDriveToken()) await requestDriveToken("consent");
      const infos = await listRemoteKeyInfos(transport());
      setRemoteKeys(infos);
      setKeyMessage({
        ok: true,
        text:
          infos.length > 0
            ? "Collegato. Su Drive c'è già una frase segreta, impostata da un altro dispositivo: inserisci quella."
            : "Collegato. Su Drive non c'è ancora una frase segreta: creane una.",
      });
    } catch {
      setKeyMessage({ ok: false, text: "Non sono riuscito a collegarmi a Google Drive. Riprova." });
    } finally {
      setBusy(false);
    }
  }

  async function onSyncDrive() {
    setDriveMessage(null);
    if (!keysReady) {
      setDriveMessage({ ok: false, text: "Prima imposta la frase segreta qui sotto: su Drive i dati vanno solo cifrati." });
      return;
    }
    setBusy(true);
    try {
      if (!hasDriveToken()) await requestDriveToken(connected ? "" : "consent");
      setDriveMessage(describeReport(await syncWith(transport(), "drive", { requireEncryption: true })));
    } catch {
      setDriveMessage({ ok: false, text: "Non sono riuscito a collegarmi a Google. Tocca di nuovo «Sincronizza ora»." });
    } finally {
      setBusy(false);
    }
  }

  function onDisconnect() {
    forgetDriveToken();
    setRemoteKeys(null);
    setDriveMessage({ ok: true, text: "Scollegato da Google su questo dispositivo. I dati restano dove sono." });
  }

  async function withKeyAction(action: () => Promise<string>) {
    setKeyMessage(null);
    setBusy(true);
    try {
      const text = await action();
      clearPhrases();
      setChanging(false);
      setKeyMessage({ ok: true, text });
    } catch (e) {
      setKeyMessage({ ok: false, text: passphraseErrorText(cryptoCode(e)) });
    } finally {
      setBusy(false);
    }
  }

  function onUnlock(event: FormEvent) {
    event.preventDefault();
    void withKeyAction(async () => {
      const result = await unlockPassphrase(passphrase, await freshRemoteKeys());
      if (driveReport) setResolvedReport(driveReport.finishedAt);
      return `Frase giusta: questo dispositivo ora legge e scrive i dati cifrati.${unmatchedNote(result.unmatched)}`;
    });
  }

  function onCreate(event: FormEvent) {
    event.preventDefault();
    void withKeyAction(async () => {
      await createPassphrase(passphrase, confirmation, await freshRemoteKeys());
      return "Frase creata. Usa la stessa su tutti i tuoi dispositivi.";
    });
  }

  function onChangePhrase(event: FormEvent) {
    event.preventDefault();
    void withKeyAction(async () => {
      await changePassphrase(currentPhrase, passphrase, confirmation, await freshRemoteKeys());
      return "Frase cambiata. I dati nuovi si cifrano con questa: sugli altri dispositivi inserisci la nuova frase. Quelli già scritti restano leggibili qui.";
    });
  }

  function onReadOlder(event: FormEvent) {
    event.preventDefault();
    void withKeyAction(async () => {
      if (!hasDriveToken()) await requestDriveToken("");
      const remote = await listRemoteKeyInfos(transport());
      setRemoteKeys(remote);
      await unlockPassphrase(olderPhrase, remote);
      return "Frase giusta: ora questo dispositivo legge anche quei dati. Tocca «Sincronizza ora» per riceverli.";
    });
  }

  async function onForget() {
    setBusy(true);
    try {
      await forgetKeys();
      setConfirmForget(false);
      setKeyMessage({ ok: true, text: "Chiave tolta da questo dispositivo. I dati non sono cambiati." });
    } finally {
      setBusy(false);
    }
  }

  async function onExport() {
    setFileMessage(null);
    setBusy(true);
    try {
      const encrypt = encryptFile && keysReady;
      const built = await exportSyncPackage({ encrypt });
      download(built.bytes, `${APP_NAME.toLowerCase()}-sincronizzazione-${dayOf(new Date().toISOString())}.json`);
      setFileMessage({
        ok: true,
        text: `File pronto con ${built.events === 1 ? "1 evento" : `${built.events} eventi`}${built.encrypted ? ", cifrato con la frase segreta" : ", non cifrato"}. Aprilo sull'altro telefono con «Unisci un file».`,
      });
    } catch {
      setFileMessage({ ok: false, text: "Non sono riuscito a preparare il file. Riprova." });
    } finally {
      setBusy(false);
    }
  }

  async function runImport(pkg: LoadedPackage, readKeys?: ReadonlyMap<string, CryptoKey>) {
    const report = await importSyncPackage(pkg, readKeys);
    const note = packageReadText(pkg.ignored);
    const withNote = (m: Message): Message => (note ? { ok: m.ok, text: `${m.text} ${note}` } : m);
    if (report.status === "ok" && report.locked > 0) {
      setLockedPackage(pkg);
      setFileMessage(withNote({ ok: false, text: "Il file è protetto da una frase segreta: inseriscila qui sotto per unirlo." }));
      return;
    }
    setLockedPackage(null);
    setFileMessage(withNote(describeReport(report)));
  }

  async function onImport(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    setFileMessage(null);
    setBusy(true);
    try {
      const pkg = readSyncPackage(await file.text());
      if (!pkg.ok) setFileMessage({ ok: false, text: packageErrorText(pkg.error) });
      else await runImport(pkg);
    } catch {
      setFileMessage({ ok: false, text: "Non sono riuscito a leggere il file. Riprova." });
    } finally {
      input.value = "";
      setBusy(false);
    }
  }

  async function onUnlockPackage(event: FormEvent) {
    event.preventDefault();
    if (!lockedPackage) return;
    setBusy(true);
    try {
      // Chiavi solo per leggere questo file: la frase segreta del dispositivo non cambia.
      const readKeys = await unlockPackageKeys(packagePhrase, lockedPackage.keyInfos);
      setPackagePhrase("");
      await runImport(lockedPackage, readKeys);
    } catch (e) {
      setFileMessage({ ok: false, text: passphraseErrorText(cryptoCode(e)) });
    } finally {
      setBusy(false);
    }
  }

  const quarantine = overview?.quarantine ?? [];

  async function onClearQuarantine() {
    setBusy(true);
    try {
      const removed = await clearQuarantine();
      setConfirmClear(false);
      setQuarantineMessage({ ok: true, text: removed === 1 ? "Tolto 1 dato messo da parte." : `Tolti ${removed} dati messi da parte.` });
    } catch {
      setQuarantineMessage({ ok: false, text: "Non sono riuscito a svuotare. Riprova." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Sincronizzazione</h1>
        <Link href="/app/impostazioni" className={ui.textLink}>
          Torna alle impostazioni
        </Link>
      </div>

      <section className={ui.section}>
        <SectionHeader label="Stato" />
        <div className={settingsStyles.block}>
          <p className={ui.paragraph}>Tiene allineati i tuoi dispositivi, senza un server dell&apos;app.</p>
          <Disclosure title="Che cosa significa" quiet>
            Con il tuo Google Drive oppure con un file. Si aggiunge soltanto, non si cancella niente.
          </Disclosure>
          <dl className={styles.facts}>
            <dt>Con Google Drive</dt>
            <dd>{lastOutcome(overview?.drive)}</dd>
            <dt>Con file</dt>
            <dd>{lastOutcome(overview?.file)}</dd>
            <dt>Questo dispositivo</dt>
            <dd>{shortDevice(overview?.deviceId)}</dd>
          </dl>
          {clock.length > 0 ? (
            <div className={ui.calloutStrong} role="note">
              {clock.map((w) => (
                <p key={`${w.deviceId}-${w.kind}`} className={ui.paragraph}>
                  {clockWarningText(w, overview?.deviceId)}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className={ui.section}>
        <SectionHeader label="Google Drive" />
        <div className={settingsStyles.block}>
          {driveReady ? (
            <>
              <p className={ui.paragraph}>Dati cifrati in una cartella nascosta: Google non può leggerli.</p>
              <Disclosure title="Che cosa significa" quiet>
                La cartella sta nel tuo Drive e solo l&apos;app la vede. I dati sono sempre cifrati con la tua frase segreta. L&apos;app chiede il permesso solo per quella cartella.
              </Disclosure>
              <div className={ui.row}>
                <Button onClick={onSyncDrive} disabled={busy}>
                  {busy ? "Sincronizzo…" : "Sincronizza ora"}
                </Button>
                {connected ? (
                  <Button variant="outline" onClick={onDisconnect} disabled={busy}>
                    Scollega Google
                  </Button>
                ) : null}
              </div>
              {overview?.drive && overview.drive.status === "ok" && !driveMessage ? (
                <p className={ui.hint}>{describeReport(overview.drive).text}</p>
              ) : null}
              <Notice message={driveMessage} />
            </>
          ) : (
            <p className={ui.paragraph}>
              La sincronizzazione con Google Drive non è ancora configurata in questa versione dell&apos;app. Intanto puoi
              allineare due telefoni con un file, qui sotto.
            </p>
          )}
        </div>
      </section>

      <section className={ui.section}>
        <SectionHeader label="Frase segreta" />
        <div className={settingsStyles.block}>
          <p className={ui.paragraph}>Con Drive è obbligatoria: cifra i dati prima che lascino il telefono.</p>
          <p className={ui.paragraph}>Se la dimentichi, i dati su Drive non si possono recuperare.</p>
          <Disclosure title="Che cosa significa" quiet>
            Usa la stessa frase su tutti i tuoi dispositivi. Non viene salvata: resta solo una chiave che nessuno può leggere. I dati sui telefoni restano anche se la dimentichi.
          </Disclosure>
          {step === "connect" ? (
            <>
              <p className={ui.paragraph}>Prima collega Google Drive.</p>
              <Disclosure title="Che cosa significa" quiet>
                Se hai già impostato la frase su un altro dispositivo, la trovo lì e ti chiedo quella.
              </Disclosure>
              <div className={ui.row}>
                <Button onClick={onConnect} disabled={busy}>
                  Collega Google Drive
                </Button>
                <Button variant="outline" onClick={() => setDriveSkipped(true)} disabled={busy}>
                  Non uso Google Drive
                </Button>
              </div>
            </>
          ) : null}
          {step === "unlock" ? (
            <form className={styles.inline} onSubmit={onUnlock}>
              <p className={ui.paragraph}>
                {remoteMismatch
                  ? "Su Drive i dati sono cifrati con una frase diversa da quella inserita su questo dispositivo, quindi non carico niente. Inserisci la frase che usi sugli altri dispositivi: da lì in poi questo dispositivo scrive con quella."
                  : "Una frase segreta esiste già. Inserisci la stessa che usi sugli altri dispositivi."}
              </p>
              <SecretField id={`${ids}-phrase`} label="Frase segreta" value={passphrase} onChange={setPassphrase} disabled={busy} />
              <div className={ui.row}>
                <Button type="submit" disabled={busy || passphrase.trim().length === 0}>
                  Sblocca
                </Button>
              </div>
            </form>
          ) : null}
          {step === "create" ? (
            <form className={styles.inline} onSubmit={onCreate}>
              <p className={ui.paragraph}>Non c&apos;è ancora una frase segreta. Scegline una e scrivila due volte.</p>
              <SecretField id={`${ids}-new`} label="Nuova frase segreta" value={passphrase} onChange={setPassphrase} disabled={busy} isNew />
              <SecretField id={`${ids}-repeat`} label="Ripeti la frase" value={confirmation} onChange={setConfirmation} disabled={busy} isNew />
              <p className={ui.hint}>Almeno 12 caratteri. Meglio quattro o cinque parole che solo tu colleghi.</p>
              <div className={ui.row}>
                <Button type="submit" disabled={busy || passphrase.trim().length === 0 || confirmation.trim().length === 0}>
                  Crea la frase
                </Button>
              </div>
            </form>
          ) : null}
          {step === "ready" ? (
            <>
              <p className={ui.paragraph}>Impostata su questo dispositivo.</p>
              {showReadOlderForm(driveReport) ? (
                <form className={styles.inline} onSubmit={onReadOlder}>
                  <p className={ui.paragraph}>
                    Alcuni dati su Drive sono cifrati con una frase che questo dispositivo non ha, per esempio quella usata prima di un
                    cambio. Inserisci un&apos;altra frase per leggere dati più vecchi: serve solo a leggerli, la scrittura non cambia.
                  </p>
                  <SecretField id={`${ids}-older`} label="Un'altra frase" value={olderPhrase} onChange={setOlderPhrase} disabled={busy} />
                  <div className={ui.row}>
                    <Button type="submit" disabled={busy || olderPhrase.trim().length === 0}>
                      Leggi i dati più vecchi
                    </Button>
                  </div>
                </form>
              ) : null}
              {changing ? (
                <form className={styles.inline} onSubmit={onChangePhrase}>
                  <SecretField id={`${ids}-current`} label="Frase attuale" value={currentPhrase} onChange={setCurrentPhrase} disabled={busy} />
                  <SecretField id={`${ids}-next`} label="Nuova frase" value={passphrase} onChange={setPassphrase} disabled={busy} isNew />
                  <SecretField id={`${ids}-next2`} label="Ripeti la nuova frase" value={confirmation} onChange={setConfirmation} disabled={busy} isNew />
                  <p className={ui.hint}>Dopo il cambio, sugli altri dispositivi dovrai inserire la nuova frase.</p>
                  <div className={ui.row}>
                    <Button type="submit" disabled={busy || !currentPhrase.trim() || !passphrase.trim() || !confirmation.trim()}>
                      Cambia la frase
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setChanging(false);
                        clearPhrases();
                      }}
                      disabled={busy}
                    >
                      Chiudi
                    </Button>
                  </div>
                </form>
              ) : confirmForget ? (
                <div className={ui.calloutStrong} role="alert">
                  <p className={ui.paragraph}>
                    Togliere la chiave da questo dispositivo? Per leggere e inviare dati cifrati dovrai inserire di nuovo la frase.
                    I dati non cambiano.
                  </p>
                  <div className={ui.row}>
                    <Button onClick={onForget} disabled={busy}>
                      Sì, togli la chiave
                    </Button>
                    <Button variant="outline" onClick={() => setConfirmForget(false)} disabled={busy}>
                      Chiudi
                    </Button>
                  </div>
                </div>
              ) : (
                <div className={ui.row}>
                  <Button variant="outline" onClick={() => setChanging(true)} disabled={busy}>
                    Cambia la frase
                  </Button>
                  <Button variant="outline" onClick={() => setConfirmForget(true)} disabled={busy}>
                    Togli la chiave da questo dispositivo
                  </Button>
                </div>
              )}
            </>
          ) : null}
          <Notice message={keyMessage} />
        </div>
      </section>

      <section className={ui.section}>
        <SectionHeader label="Sincronizzazione con file" />
        <div className={settingsStyles.block}>
          <p className={ui.paragraph}>Funziona subito, senza account.</p>
          <Disclosure title="Che cosa significa" quiet>
            Prepara il file su un telefono, mandalo all&apos;altro (messaggio, cavo, chiavetta) e aprilo lì con «Unisci un file». Poi fai lo stesso nel verso opposto. Unire non cancella niente.
          </Disclosure>
          <label className={ui.switch}>
            <input type="checkbox" checked={encryptFile && keysReady} disabled={!keysReady || busy} onChange={(e) => setEncryptFile(e.target.checked)} />
            <span className={ui.switchText}>
              Proteggi il file con la frase segreta
              {!keysReady ? <span className={ui.hint}>Imposta prima la frase segreta.</span> : null}
            </span>
          </label>
          <p className={encryptFile && keysReady ? ui.hint : ui.error}>{exportNotice(encryptFile && keysReady)}</p>
          <div className={ui.row}>
            <Button variant="outline" onClick={onExport} disabled={busy}>
              Prepara il file
            </Button>
            <label className={settingsStyles.file}>
              <input type="file" accept="application/json,.json" onChange={onImport} disabled={busy} />
              <span>Unisci un file</span>
            </label>
          </div>
          {lockedPackage ? (
            <form className={styles.inline} onSubmit={onUnlockPackage}>
              <label className={ui.field} htmlFor={`${ids}-pkg`}>
                <span className={ui.fieldLabel}>Frase segreta del file</span>
                <input
                  id={`${ids}-pkg`}
                  className={ui.input}
                  type="password"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={packagePhrase}
                  onChange={(e) => setPackagePhrase(e.target.value)}
                  disabled={busy}
                />
              </label>
              <div className={ui.row}>
                <Button type="submit" disabled={busy || packagePhrase.trim().length === 0}>
                  Sblocca e unisci
                </Button>
                <Button variant="outline" onClick={() => setLockedPackage(null)} disabled={busy}>
                  Chiudi
                </Button>
              </div>
            </form>
          ) : null}
          <Notice message={fileMessage} />
        </div>
      </section>

      <section className={ui.section}>
        <SectionHeader label="Dati messi da parte" />
        <div className={settingsStyles.block}>
          {quarantine.length === 0 ? (
            <p className={ui.paragraph}>Nessuno. Qui compaiono i dati arrivati da un altro dispositivo che non si possono applicare.</p>
          ) : (
            <>
              <p className={ui.paragraph}>Questi dati sono arrivati ma non sono stati applicati.</p>
              <Disclosure title="Che cosa significa" quiet>
                Restano conservati qui; quelli che una versione più recente dell&apos;app sa leggere vengono riprovati dopo un aggiornamento.
              </Disclosure>
              <ul className={styles.list}>
                {quarantine.map((q) => (
                  <li key={q.id} className={styles.item}>
                    <p className={ui.paragraph}>{quarantineReasonText(q.reason)}</p>
                    <p className={ui.hint}>
                      {q.kind === "event" ? "Un evento" : "Un blocco di dati"} dal dispositivo {shortDevice(q.deviceId)}, arrivato{" "}
                      {when(q.receivedAt)}.
                    </p>
                    {q.truncated ? <p className={ui.hint}>Contenuto troppo lungo: qui se ne vede solo l&apos;inizio.</p> : null}
                    {q.raw ? (
                      <details className={styles.details}>
                        <summary>Mostra il contenuto</summary>
                        <pre className={styles.raw}>{q.raw}</pre>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
              {confirmClear ? (
                <div className={ui.calloutStrong} role="alert">
                  <p className={ui.paragraph}>{clearQuarantineQuestion(quarantine.length)}</p>
                  <div className={ui.row}>
                    <Button onClick={onClearQuarantine} disabled={busy}>
                      Sì, svuota
                    </Button>
                    <Button variant="outline" onClick={() => setConfirmClear(false)} disabled={busy}>
                      Chiudi
                    </Button>
                  </div>
                </div>
              ) : (
                <div className={ui.row}>
                  <Button variant="outline" onClick={() => setConfirmClear(true)} disabled={busy}>
                    Svuota la quarantena
                  </Button>
                </div>
              )}
            </>
          )}
          <Notice message={quarantineMessage} />
        </div>
      </section>

      <section className={ui.section}>
        <SectionHeader label="Cosa viene sincronizzato" />
        <div className={settingsStyles.block}>
          <ul className={styles.list}>
            {SYNC_SCOPE.map((item) => {
              const t = scopeText(item.id);
              return (
                <li key={item.id} className={styles.item}>
                  <p className={ui.paragraph}>
                    <strong>{item.synced ? "Sì" : "No"}</strong> · {t.label}
                  </p>
                  <p className={ui.hint}>{t.detail}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </div>
  );
}
