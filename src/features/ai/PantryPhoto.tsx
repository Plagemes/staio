"use client";

import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import { LOCATION_NAMES, SCAN_LOCATIONS, formatCost, isAiError, type DiffKind, type Difference, type ScanLocation } from "@/core/ai";
import { activeLots, type LedgerEvent } from "@/core/ledger";
import { appendEvents, getAllEvents, getDeviceId, usePantry } from "@/data";
import { Button, Label, SectionHeader } from "@/design";
import { buildUndo } from "../actions";
import { Disclosure } from "../common";
import { dayOf } from "../format";
import { LOCATION_LABELS } from "../labels";
import { useNotice } from "../notice";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { IMAGE_ERROR_MESSAGES, ImageError, PANTRY_IMAGE_LIMITS, prepareImage, type PreparedImage } from "./image";
import { NotReady } from "./NotReady";
import { describeAiError } from "./messages";
import { buildPhotoEvents, zoneObservations, type PhotoEventsResult } from "./photoEvents";
import { scanPantry, type ScanOutcome } from "./photoScan";
import { PROVIDER_LABELS } from "./providers/types";
import { activeModel, configIssue, destinationHost, dexieSettingsStore, type AiSettings } from "./settings";
import { useAiSettings } from "./useAiSettings";
import { AI_ZONES_KEY, recordZones } from "./zonesStore";
import styles from "./PantryPhoto.module.css";

const MAX_PHOTOS = 4;

const KIND_LABELS: Record<DiffKind, string> = {
  quantity_changed: "Quantità",
  probably_finished: "Probabilmente finito",
  unexpected_item: "Non è nel registro",
  expiry_differs: "Scadenza",
  use_soon: "Da consumare presto",
};

const certaintyText = (c: number) => `Certezza ${c >= 0.75 ? "alta" : c >= 0.5 ? "media" : "bassa"} (${Math.round(c * 100)}%)`;

interface Photo {
  id: number;
  prepared: PreparedImage;
}

/** `eaten` e `discarded` solo per gli avvisi: sono le azioni di sempre sul lotto, non una modifica della scadenza. */
type Decision = "confirmed" | "ignored" | "eaten" | "discarded";

const DECISION_TEXT: Record<Decision, string> = { confirmed: "Confermato", ignored: "Ignorato", eaten: "Segnato mangiato", discarded: "Segnato buttato" };

const isWrite = (d: Decision | undefined) => d === "confirmed" || d === "eaten" || d === "discarded";
type Busy = "preparing" | "scanning" | "writing" | null;

export function PantryPhoto() {
  const { settings, ready } = useAiSettings();
  if (!ready) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Foto della dispensa</h1>
        <LoadingLine text="Un attimo…" />
      </div>
    );
  }
  const issue = configIssue(settings);
  if (issue !== null) {
    return <NotReady issue={issue} title="Foto della dispensa" what="controllare la dispensa da una foto" alternative={{ href: "/app/dispensa", label: "Torna alla dispensa" }} />;
  }
  return <Scanner settings={settings} />;
}

function Scanner({ settings }: { settings: AiSettings }) {
  const ids = useId();
  const now = useNow();
  const notice = useNotice();
  const pantry = usePantry();
  const abortRef = useRef<AbortController | null>(null);
  const photoId = useRef(0);

  const [location, setLocation] = useState<ScanLocation>("frigo");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [done, setDone] = useState<{ result: PhotoEventsResult; undone: boolean } | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const lots = useMemo(() => (pantry.data ? activeLots(pantry.data, location) : []), [pantry.data, location]);
  const counts = useMemo(
    () => Object.fromEntries(SCAN_LOCATIONS.map((l) => [l, pantry.data ? activeLots(pantry.data, l).length : 0])) as Record<ScanLocation, number>,
    [pantry.data],
  );

  if (pantry.error) return <StorageError />;
  if (!pantry.data || !now) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Foto della dispensa</h1>
        <LoadingLine />
      </div>
    );
  }

  const providerName = PROVIDER_LABELS[settings.provider];
  const model = activeModel(settings);
  const host = destinationHost(settings);
  const placeName = LOCATION_LABELS[location].toLowerCase();

  function chooseLocation(next: ScanLocation) {
    if (busy) return;
    setLocation(next);
    setOutcome(null);
    setDecisions({});
    setError(null);
  }

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0 || busy) return;
    setError(null);
    setBusy("preparing");
    try {
      const room = MAX_PHOTOS - photos.length;
      const added: Photo[] = [];
      for (const file of files.slice(0, Math.max(0, room))) {
        added.push({ id: ++photoId.current, prepared: await prepareImage(file, PANTRY_IMAGE_LIMITS) });
      }
      setPhotos((all) => [...all, ...added]);
      if (files.length > room) setError(`Al massimo ${MAX_PHOTOS} foto per volta: ne ho tenute ${added.length}.`);
    } catch (e) {
      setError(IMAGE_ERROR_MESSAGES[e instanceof ImageError ? e.kind : "decode"]);
    } finally {
      setBusy(null);
    }
  }

  async function onScan() {
    if (photos.length === 0 || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setOutcome(null);
    setDecisions({});
    setBusy("scanning");
    try {
      const out = await scanPantry({
        store: dexieSettingsStore(),
        zoneStore: dexieSettingsStore(AI_ZONES_KEY),
        location,
        lots,
        images: photos.map((p) => p.prepared.image),
        today: dayOf(new Date().toISOString()),
        signal: controller.signal,
      });
      setOutcome(out);
    } catch (e) {
      setError(isAiError(e) ? describeAiError(e, { provider: settings.provider, model }) : "La lettura non è riuscita. Riprova.");
    } finally {
      abortRef.current = null;
      setBusy(null);
    }
  }

  function decide(key: string, decision: Decision | null) {
    setDecisions((all) => {
      const next = { ...all };
      if (decision === null) delete next[key];
      else next[key] = decision;
      return next;
    });
  }

  async function onWrite() {
    if (!outcome || !pantry.data || busy) return;
    const confirmed = outcome.differences.filter((d) => isWrite(decisions[d.key]));
    const actions: Record<string, "eaten" | "discarded"> = {};
    for (const d of confirmed) {
      const choice = decisions[d.key];
      if (choice === "eaten" || choice === "discarded") actions[d.key] = choice;
    }
    if (confirmed.length === 0) return;
    setBusy("writing");
    setError(null);
    try {
      const nowIso = new Date().toISOString();
      const [allEvents, deviceId] = await Promise.all([getAllEvents(), getDeviceId()]);
      // lo stato di ogni lotto è quello di adesso, non quello di quando è partita la foto
      const current = new Map(pantry.data.lots.map((l) => [l.lotId, l]));
      const lotsById = new Map([...outcome.target.lotsById].map(([id, lot]) => [id, current.get(lot.lotId) ?? lot]));
      const result = buildPhotoEvents(confirmed, {
        now: nowIso,
        deviceId,
        location,
        lotsById,
        events: allEvents,
        voidedEventIds: pantry.data.voidedEventIds,
        actions,
      });
      if (result.events.length === 0) {
        setError(result.errors[0]?.message ?? "Non c'è niente da scrivere.");
        return;
      }
      const written = await appendEvents(result.events);
      if (written.added === 0) {
        setError("Non sono riuscito a salvare. Riprova.");
        return;
      }
      notice.show({ message: `Aggiornato il ${placeName} da foto: ${result.written.length} ${result.written.length === 1 ? "modifica" : "modifiche"}.`, undo: result.events });
      try {
        await recordZones(dexieSettingsStore(AI_ZONES_KEY), zoneObservations(confirmed, location, nowIso));
      } catch {
        // la mappa è un aiuto: se non si riesce a scriverla, ciò che l'utente ha confermato è comunque salvato
      }
      setDone({ result, undone: false });
    } catch {
      setError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      setBusy(null);
    }
  }

  async function onUndo() {
    if (!done || done.undone || busy) return;
    setBusy("writing");
    try {
      await appendEvents(buildUndo(done.result.events as readonly LedgerEvent[], { now: new Date().toISOString(), deviceId: await getDeviceId() }));
      setDone({ ...done, undone: true });
    } catch {
      setError("Non sono riuscito ad annullare. Riprova.");
    } finally {
      setBusy(null);
    }
  }

  function startOver() {
    setOutcome(null);
    setDecisions({});
    setDone(null);
    setError(null);
    setPhotos([]);
  }

  /** Torna alla scelta delle foto tenendo quelle già pronte, per aggiungerne una mirata. */
  function addPhoto() {
    setOutcome(null);
    setDecisions({});
    setError(null);
  }

  const confirmedCount = outcome ? outcome.differences.filter((d) => isWrite(decisions[d.key])).length : 0;
  const decidedCount = outcome ? outcome.differences.filter((d) => decisions[d.key] !== undefined).length : 0;
  const unseen = outcome ? outcome.scan.lots.filter((l) => l.status === "not_seen") : [];
  const nameOf = (id: string) => outcome?.target.expected.find((e) => e.id === id)?.name ?? id;
  const warnings = outcome?.scan.problems.filter((p) => p.severity === "warning") ?? [];

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Foto della dispensa</h1>
        <Label>Con l&apos;intelligenza artificiale</Label>
      </div>

      {done ? (
        <section className={ui.section} aria-live="polite">
          <SectionHeader label={done.undone ? "Annullato" : "Scritto nel registro"} />
          <div className={ui.empty}>
            <h2 className={ui.emptyTitle}>{done.undone ? "Ho annullato tutto" : `Fatto: ${done.result.written.length} ${done.result.written.length === 1 ? "modifica" : "modifiche"}`}</h2>
            {done.undone ? (
              <p className={ui.emptyText}>Il registro è tornato com&apos;era prima di questa foto.</p>
            ) : (
              <>
                <ul className={styles.summary}>
                  {done.result.written.map((w) => (
                    <li key={w.key}>{w.summary}</li>
                  ))}
                </ul>
                {done.result.errors.length > 0 ? (
                  <p className={ui.error} role="alert">
                    {done.result.errors.length === 1 ? "Una conferma non è stata scritta" : `${done.result.errors.length} conferme non sono state scritte`}: {done.result.errors.map((e) => e.message).join(" ")}
                  </p>
                ) : null}
                <p className={ui.hint}>Tutto è segnato come stimato dalla foto.</p>
                <Disclosure quiet title="Che cosa significa">
                  «Annulla» toglie queste modifiche senza cancellare nulla.
                </Disclosure>
              </>
            )}
            {error ? (
              <p className={ui.error} role="alert">
                {error}
              </p>
            ) : null}
            <div className={ui.row}>
              {done.undone ? null : (
                <Button variant="outline" onClick={onUndo} disabled={busy !== null}>
                  Annulla
                </Button>
              )}
              <Button href="/app/dispensa" variant={done.undone ? "primary" : "outline"}>
                Torna alla dispensa
              </Button>
              <Button variant="text" onClick={startOver}>
                Un&apos;altra foto
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <>
          {outcome === null ? (
            <>
              <p className={ui.lead}>
                Scegli dove hai fotografato: so già cosa dovrebbe esserci, e ti chiedo di confermare o smentire. Ogni differenza la decidi tu, una per una.
              </p>

              <fieldset className={ui.field}>
                <legend className={ui.fieldLabel}>Dove</legend>
                <div className={ui.choices}>
                  {SCAN_LOCATIONS.map((l) => (
                    <label key={l} className={ui.choice}>
                      <input type="radio" name={`${ids}-place`} value={l} checked={location === l} onChange={() => chooseLocation(l)} disabled={busy !== null} />
                      <span>
                        {LOCATION_LABELS[l]} ({counts[l]})
                      </span>
                    </label>
                  ))}
                </div>
                <p className={ui.hint}>
                  {lots.length === 0
                    ? `Nel registro non c'è niente in ${LOCATION_NAMES[location]}: guarderò solo cosa vedo di nuovo.`
                    : `Nel registro ci sono ${lots.length} voci in ${LOCATION_NAMES[location]}; la foto serve a confermarle.`}
                </p>
              </fieldset>

              <div className={ui.calloutStrong} role="note">
                <p className={ui.paragraph}>
                  <strong>Prima di guardare.</strong> Le foto (ridotte sul telefono) e la tua chiave vengono inviate a <strong>{host}</strong> ({providerName}), con il modello «{model}», insieme
                  all&apos;elenco di ciò che il registro dice che c&apos;è. Ogni lettura ha un costo sul tuo conto presso il fornitore. Non fotografare persone o documenti.
                </p>
              </div>

              <div className={styles.pick}>
                <label className={styles.file}>
                  <input type="file" accept="image/*" capture="environment" onChange={onFiles} disabled={busy !== null || photos.length >= MAX_PHOTOS} />
                  <span>Scatta una foto</span>
                </label>
                <label className={styles.file}>
                  <input type="file" accept="image/*" multiple onChange={onFiles} disabled={busy !== null || photos.length >= MAX_PHOTOS} />
                  <span>Scegli dalla galleria</span>
                </label>
              </div>
              <p className={ui.hint}>
                Fino a {MAX_PHOTOS} foto: il ripiano alto e basso, il cassetto, lo sportello. Con le porte aperte e abbastanza luce.
                {photos.length > 0 ? ` Ne hai ${photos.length}.` : ""}
              </p>
              {busy === "preparing" ? (
                <p className={ui.hint} role="status">
                  Preparo le foto…
                </p>
              ) : null}

              {photos.length > 0 ? (
                <ul className={styles.thumbs}>
                  {photos.map((p, i) => (
                    <li key={p.id} className={styles.thumb}>
                      {/* anteprima locale dell'immagine già ridotta: non passa da next/image */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`data:${p.prepared.image.mediaType};base64,${p.prepared.image.dataBase64}`} alt={`Foto ${i + 1} che verrà inviata`} />
                      <button type="button" className={styles.remove} onClick={() => setPhotos((all) => all.filter((x) => x.id !== p.id))} disabled={busy !== null}>
                        Togli
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {photos.length > 0 ? (
                <div className={ui.row}>
                  <Button onClick={onScan} disabled={busy !== null}>
                    {busy === "scanning" ? "Guardo le foto…" : photos.length === 1 ? "Guarda la foto" : `Guarda le ${photos.length} foto`}
                  </Button>
                  {busy === "scanning" ? (
                    <Button variant="outline" onClick={() => abortRef.current?.abort()}>
                      Ferma
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {busy === "scanning" ? (
                <p className={ui.hint} role="status">
                  Può volerci mezzo minuto. Le foto sono in viaggio verso il fornitore.
                </p>
              ) : null}
              {error ? (
                <p className={ui.error} role="alert">
                  {error}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <div className={ui.callout} role="note">
                <p className={ui.paragraph}>
                  <strong>Sono stime dalla foto.</strong> Ho visto {outcome.scan.lots.filter((l) => l.status === "seen").length} voci su {outcome.target.expected.length}.
                  {outcome.scan.lots.some((l) => l.status === "absent") ? ` ${outcome.scan.lots.filter((l) => l.status === "absent").length} non ci sono più.` : ""}
                  {unseen.length > 0 ? ` ${unseen.length} non le ho viste: per quelle non cambio niente.` : ""}
                </p>
                <p className={ui.hint}>
                  Questa lettura: {outcome.usage.inputTokens.toLocaleString("it-IT")} token in ingresso, {outcome.usage.outputTokens.toLocaleString("it-IT")} in uscita
                  {outcome.cost !== null ? `, costo stimato ${formatCost(outcome.cost, outcome.currency)}` : ""}.
                  {outcome.usageEstimated ? " Il fornitore non ha indicato i token usati: ho contato una stima prudente (per eccesso)." : ""}
                </p>
              </div>

              {outcome.second ? (
                <div className={ui.calloutStrong} role="status">
                  <p className={ui.paragraph}>
                    <strong>Meglio una seconda foto.</strong> {outcome.second.text}
                  </p>
                  <div className={ui.row}>
                    <Button variant="outline" onClick={addPhoto}>
                      Aggiungi una foto e rileggi
                    </Button>
                  </div>
                  <p className={ui.hint}>Rileggere costa di nuovo: le differenze non ancora confermate si perdono.</p>
                </div>
              ) : null}

              {warnings.length > 0 || outcome.truncated ? (
                <div className={ui.callout}>
                  <p className={ui.paragraph}>
                    <strong>Da sapere</strong>
                  </p>
                  <ul className={ui.bullets}>
                    {warnings.map((p, i) => (
                      <li key={`${p.code}-${i}`} className={ui.paragraph}>
                        {p.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {outcome.scan.unreadable.length > 0 ? (
                <p className={ui.hint}>Parti dell&apos;inquadratura che non si leggevano: {outcome.scan.unreadable.join("; ")}.</p>
              ) : null}

              <section className={ui.section}>
                <SectionHeader label={`Differenze (${outcome.differences.length})`} />
                {outcome.differences.length === 0 ? (
                  <div className={ui.empty}>
                    <h2 className={ui.emptyTitle}>Nessuna differenza</h2>
                    <p className={ui.emptyText}>Quello che ho visto torna con il registro. Non c&apos;è niente da cambiare.</p>
                  </div>
                ) : (
                  <ul className={styles.cards}>
                    {outcome.differences.map((d) => (
                      <DifferenceCard key={d.key} diff={d} decision={decisions[d.key]} onDecide={(decision) => decide(d.key, decision)} />
                    ))}
                  </ul>
                )}
              </section>

              {unseen.length > 0 ? (
                <section className={ui.section}>
                  <SectionHeader label={`Non visti (${unseen.length})`} />
                  <p className={styles.plain}>Potrebbero essere coperti o fuori dall&apos;inquadratura: non li considero finiti. {unseen.map((l) => nameOf(l.id)).join(", ")}.</p>
                </section>
              ) : null}

              {error ? (
                <p className={ui.error} role="alert">
                  {error}
                </p>
              ) : null}
              {outcome.differences.length > 0 ? (
                <p className={ui.hint}>
                  Hai risposto a {decidedCount} su {outcome.differences.length}. Non si scrive niente finché non premi il pulsante.
                </p>
              ) : null}
              <div className={ui.row}>
                <Button onClick={onWrite} disabled={busy !== null || confirmedCount === 0}>
                  {busy === "writing" ? "Scrivo…" : confirmedCount === 1 ? "Scrivi 1 conferma" : `Scrivi ${confirmedCount} conferme`}
                </Button>
                <Button variant="outline" onClick={startOver} disabled={busy !== null}>
                  Scarta e ricomincia
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function DifferenceCard({ diff, decision, onDecide }: { diff: Difference; decision?: Decision; onDecide: (d: Decision | null) => void }) {
  const notice = diff.change.type === "notice";
  const question = diff.mode === "question" && !notice;
  return (
    <li className={decision ? `${styles.card} ${styles.cardDone}` : styles.card}>
      <div className={styles.cardTop}>
        <Label>{notice ? "Avviso" : question ? `Domanda · ${KIND_LABELS[diff.kind]}` : KIND_LABELS[diff.kind]}</Label>
        <span className={styles.certainty}>{certaintyText(diff.confidence)}</span>
      </div>
      <h3 className={styles.title}>{question ? diff.question : diff.name}</h3>
      <p className={styles.reason}>{diff.reason}</p>
      {decision ? (
        <div className={styles.decided}>
          <span>{DECISION_TEXT[decision]}</span>
          <button type="button" className={styles.change} onClick={() => onDecide(null)}>
            Correggi
          </button>
        </div>
      ) : diff.change.type === "notice" ? (
        <div className={styles.actions}>
          <Button onClick={() => onDecide("eaten")}>L&apos;ho mangiato</Button>
          <Button variant="outline" onClick={() => onDecide("discarded")}>
            L&apos;ho buttato
          </Button>
          <Button variant="text" onClick={() => onDecide("ignored")}>
            Ho capito
          </Button>
        </div>
      ) : (
        <div className={styles.actions}>
          <Button onClick={() => onDecide("confirmed")}>{question ? diff.confirmLabel : "Conferma"}</Button>
          <Button variant="outline" onClick={() => onDecide("ignored")}>
            {question ? diff.declineLabel : "Ignora"}
          </Button>
        </div>
      )}
    </li>
  );
}
