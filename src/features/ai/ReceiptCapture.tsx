"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { formatCost, isAiError, usageForMonth } from "@/core/ai";
import { emptyMemory, entryCount, normalizeStoreKey, type LoadedMemory, type MemoryRow } from "@/core/ai/receiptMemory";
import { expiryReviewRows } from "@/core/ai/receiptExpiry";
import type { LedgerEvent, PurchaseEvent } from "@/core/ledger";
import { appendEvents, getDeviceId } from "@/data";
import { Button, Label, SectionHeader } from "@/design";
import { buildUndo } from "../actions";
import { dayOf, formatPrice } from "../format";
import { useNotice } from "../notice";
import { useNow } from "../useNow";
import ui from "../ui.module.css";
import { activeModel, configIssue, destinationHost, dexieSettingsStore, type AiSettings } from "./settings";
import { IMAGE_ERROR_MESSAGES, ImageError, prepareImage, type PreparedImage } from "./image";
import { describeAiError } from "./messages";
import { NotReady } from "./NotReady";
import { PROVIDER_LABELS } from "./providers/types";
import { readReceipt, type ReceiptReadResult } from "./readReceipt";
import { ExpiryReview } from "./ExpiryReview";
import { buildReceiptEvents, includedTotalCents, storeLabel, toReviewLines, type ReviewLine } from "./receiptEvents";
import { applyMemory, reapplyMemory, rememberedCount, adoptRemembered } from "./receiptLearning";
import { forgetIgnore, forgetMemory, loadMemory, rememberReceipt, restoreMemory } from "./receiptMemoryStore";
import type { LinePatch } from "./receiptProduct";
import { ReviewRow } from "./ReviewRow";
import { useAiSettings } from "./useAiSettings";
import styles from "./ReceiptCapture.module.css";

const formatBytes = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1000))} kB`);

export function ReceiptCapture() {
  const { settings, ready } = useAiSettings();

  if (!ready) {
    return (
      <div className={ui.screen}>
        <div className={ui.head}>
          <h1 className={ui.title}>Scontrino</h1>
        </div>
        <p className={ui.lead} role="status">
          Un attimo…
        </p>
      </div>
    );
  }

  const issue = configIssue(settings);
  if (issue !== null) {
    return <NotReady issue={issue} title="Scontrino" what="leggere uno scontrino da una foto" alternative={{ href: "/app/cattura", label: "Aggiungi a mano" }} />;
  }
  return <Reader settings={settings} />;
}

type Busy = "preparing" | "reading" | "saving" | null;

function Reader({ settings }: { settings: AiSettings }) {
  const ids = useId();
  const now = useNow();
  const notice = useNotice();
  const abortRef = useRef<AbortController | null>(null);

  const [image, setImage] = useState<PreparedImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReceiptReadResult | null>(null);
  const [lines, setLines] = useState<ReviewLine[]>([]);
  const [storeName, setStoreName] = useState("");
  const [date, setDate] = useState("");
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ count: number; skipped: number; purchases: PurchaseEvent[]; summary: string; reviewing: boolean } | null>(null);
  const [memory, setMemory] = useState<LoadedMemory>(emptyMemory);
  // le righe com'erano appena lette, prima della memoria: servono a rileggere la memoria se cambia il negozio
  const baseRef = useRef<ReviewLine[]>([]);
  // scadenze scritte dalla revisione: se lo scontrino viene annullato, si annullano con lui
  const reviewEventsRef = useRef<readonly LedgerEvent[]>([]);
  // com'era la memoria prima di questo scontrino: l'«Annulla» dello scontrino la rimette
  const memoryBeforeRef = useRef<{ storeName: string; row: MemoryRow } | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const providerName = PROVIDER_LABELS[settings.provider];
  const model = activeModel(settings);
  const host = destinationHost(settings);
  const month = now ? usageForMonth(settings.usage, now) : null;

  function clearResult() {
    setResult(null);
    setLines([]);
    setRowErrors({});
    setFormError(null);
    setSaved(null);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file || busy) return;
    setError(null);
    clearResult();
    setBusy("preparing");
    try {
      const prepared = await prepareImage(file);
      setImage(prepared);
      setPreviewUrl(URL.createObjectURL(prepared.blob));
    } catch (e) {
      setImage(null);
      setPreviewUrl(null);
      setError(IMAGE_ERROR_MESSAGES[e instanceof ImageError ? e.kind : "decode"]);
    } finally {
      setBusy(null);
    }
  }

  async function onRead() {
    if (!image || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    clearResult();
    setBusy("reading");
    try {
      const out = await readReceipt({
        store: dexieSettingsStore(),
        images: [image.image],
        today: dayOf(new Date().toISOString()),
        signal: controller.signal,
      });
      const name = storeLabel(out.reading);
      const base = toReviewLines(out.reading);
      const learned = await loadMemory(name);
      baseRef.current = base;
      setMemory(learned);
      setResult(out);
      setLines(base.map((l) => applyMemory(l, learned)));
      setStoreName(name);
      setDate(out.reading.date ?? "");
    } catch (e) {
      if (isAiError(e)) {
        setError(describeAiError(e, { provider: settings.provider, model }));
      } else {
        setError("La lettura non è riuscita. Riprova.");
      }
    } finally {
      abortRef.current = null;
      setBusy(null);
    }
  }

  function updateLine(key: string, patch: LinePatch) {
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch, touched: true } : l)));
    if (rowErrors[key]) setRowErrors((e) => ({ ...e, [key]: "" }));
  }

  function adoptLineMemory(key: string) {
    setLines((all) => all.map((l) => (l.key === key ? adoptRemembered(l) : l)));
  }

  // Il negozio è cambiato (o è stato scritto a mano): le righe non ancora toccate si rileggono dalla memoria di quel negozio.
  async function onStoreBlur() {
    if (normalizeStoreKey(storeName) === memory.storeKey) return;
    const learned = await loadMemory(storeName);
    setMemory(learned);
    setLines((all) => reapplyMemory(all, baseRef.current, learned));
  }

  async function onForget() {
    const name = storeName;
    const old = await forgetMemory(name);
    const learned = await loadMemory(name);
    setMemory(learned);
    setLines((all) => reapplyMemory(all, baseRef.current, learned).map((l) => (l.touched ? l : { ...l, remembered: undefined })));
    notice.show({
      message: memory.storeKey === "" ? "Ho dimenticato ciò che avevo imparato." : "Ho dimenticato ciò che avevo imparato per questo negozio.",
      onUndo: async () => {
        await restoreMemory(name, old);
        const back = await loadMemory(name);
        setMemory(back);
        setLines((all) => reapplyMemory(all, baseRef.current, back));
      },
    });
  }

  /**
   * Un solo avviso e un solo «Annulla» per tutto lo scontrino: toglie gli alimenti, le scadenze già scritte dalla
   * revisione e ciò che la memoria ha imparato da questo scontrino, e chiude la revisione.
   */
  function showReceiptNotice(message: string, purchases: readonly LedgerEvent[]) {
    notice.show({
      message,
      undo: purchases,
      onUndo: async () => {
        setSaved((s) => (s ? { ...s, reviewing: false } : s));
        const extra = reviewEventsRef.current;
        if (extra.length > 0) {
          const voided = await appendEvents(buildUndo(extra, { now: new Date().toISOString(), deviceId: await getDeviceId() }));
          if (voided.added === 0) throw new Error("annullamento non scritto");
          reviewEventsRef.current = [];
        }
        const before = memoryBeforeRef.current;
        if (before) {
          await restoreMemory(before.storeName, before.row);
          memoryBeforeRef.current = null;
        }
      },
    });
  }

  async function onStopIgnoring(key: string) {
    const line = lines.find((l) => l.key === key);
    updateLine(key, { ignoreAlways: false });
    if (!line?.memoryKey) return;
    setMemory(await forgetIgnore(memory.storeKey, line.memoryKey));
  }

  async function onSave() {
    if (!result || busy) return;
    setBusy("saving");
    setFormError(null);
    try {
      const built = buildReceiptEvents(lines, { store: storeName, date }, { now: new Date().toISOString(), deviceId: await getDeviceId() });
      if (!built.ok) {
        setRowErrors(built.errors);
        setFormError(built.form ?? "Controlla le righe segnate: manca qualcosa.");
        const first = lines.find((l) => built.errors[l.key]);
        if (first) document.getElementById(`${ids}-${first.key}-name`)?.focus();
        return;
      }
      const written = await appendEvents(built.events);
      if (written.added === 0) {
        setFormError("Non sono riuscito a salvare. Riprova.");
        return;
      }
      reviewEventsRef.current = [];
      const learned = await rememberReceipt(storeName, lines, new Date().toISOString());
      memoryBeforeRef.current = { storeName, row: learned.before.row };
      showReceiptNotice(`Aggiunti ${built.summary}.`, built.events);
      setSaved({
        count: written.added,
        skipped: built.events.length - written.added,
        purchases: built.events,
        summary: built.summary,
        reviewing: expiryReviewRows(built.events).length > 0,
      });
    } catch {
      setFormError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      setBusy(null);
    }
  }

  function startOver() {
    setImage(null);
    setPreviewUrl(null);
    setError(null);
    clearResult();
    setMemory(emptyMemory());
    baseRef.current = [];
  }

  const chosen = lines.filter((l) => l.include);
  const check = result?.check;
  const warnings = result?.reading.problems.filter((p) => p.severity === "warning") ?? [];
  const infos = result?.reading.problems.filter((p) => p.severity === "info") ?? [];
  const cost = result && result.cost !== null ? formatCost(result.cost, result.currency) : null;
  const choosing = !image && !result;
  const fromMemory = rememberedCount(lines);

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Scontrino</h1>
        <Label>Con l&apos;intelligenza artificiale</Label>
      </div>

      {saved ? (
        <>
        <div className={ui.empty} role="status">
          <h2 className={ui.emptyTitle}>Fatto</h2>
          <p className={ui.emptyText}>
            {saved.count === 1 ? "Ho aggiunto 1 alimento" : `Ho aggiunto ${saved.count} alimenti`} alla dispensa, con la scadenza stimata dalla categoria e dal luogo. Se
            hai sbagliato, «Annulla» nell&apos;avviso in basso li toglie.
            {saved.skipped > 0 ? ` ${saved.skipped} non sono stati salvati.` : ""}
          </p>
          {saved.reviewing ? null : (
            <div className={ui.row}>
              <Button href="/app/dispensa">Vai alla dispensa</Button>
              <Button variant="outline" onClick={startOver}>
                Leggi un altro scontrino
              </Button>
            </div>
          )}
        </div>
        {saved.reviewing ? (
          <ExpiryReview
            purchases={saved.purchases}
            onDone={() => setSaved((s) => (s ? { ...s, reviewing: false } : s))}
            onWritten={(events) => {
              reviewEventsRef.current = events;
              showReceiptNotice(`Aggiunti ${saved.summary}, scadenze aggiornate: ${events.length}.`, saved.purchases);
            }}
          />
        ) : null}
        </>
      ) : (
        <>
          {result === null ? (
            <>
              <p className={ui.lead}>
                Fotografa lo scontrino: ti propongo gli alimenti, con quantità, categoria e luogo. Tu rivedi ogni riga prima che entri nel registro.
              </p>

              <div className={ui.calloutStrong} role="note">
                <p className={ui.paragraph}>
                  <strong>Prima di leggere.</strong> La foto (ridotta sul telefono) e la tua chiave vengono inviate a <strong>{host}</strong> ({providerName}), con il modello «{model}».
                  Ogni lettura ha un costo sul tuo conto presso il fornitore. Se lo scontrino mostra dati personali (nome, carta fedeltà), coprili prima di fotografarlo.
                </p>
                {month && settings.monthlyCap !== null ? (
                  <p className={ui.hint}>
                    Tetto del mese: {formatCost(settings.monthlyCap, settings.currency)}; finora stimati {formatCost(month.cost, settings.currency)}.
                  </p>
                ) : null}
              </div>

              <div className={styles.pick}>
                <label className={styles.file}>
                  <input type="file" accept="image/*" capture="environment" onChange={onFile} disabled={busy !== null} />
                  <span>{image ? "Scatta un'altra foto" : "Scatta una foto"}</span>
                </label>
                <label className={styles.file}>
                  <input type="file" accept="image/*" onChange={onFile} disabled={busy !== null} />
                  <span>Scegli un&apos;immagine</span>
                </label>
              </div>
              {busy === "preparing" ? (
                <p className={ui.hint} role="status">
                  Preparo la foto…
                </p>
              ) : null}

              {image && previewUrl ? (
                <div className={styles.previewBox}>
                  {/* anteprima locale dell'immagine appena ridotta: non passa da next/image */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className={styles.preview} src={previewUrl} alt="Anteprima dello scontrino che verrà inviato" />
                  <p className={ui.hint}>
                    {image.width} × {image.height} px, {formatBytes(image.blob.size)} (originale {formatBytes(image.originalBytes)}). Controlla che si legga bene.
                  </p>
                </div>
              ) : null}

              {image ? (
                <div className={ui.row}>
                  <Button onClick={onRead} disabled={busy !== null}>
                    {busy === "reading" ? "Leggo lo scontrino…" : "Leggi lo scontrino"}
                  </Button>
                  {busy === "reading" ? (
                    <Button variant="outline" onClick={() => abortRef.current?.abort()}>
                      Annulla
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {busy === "reading" ? (
                <p className={ui.hint} role="status">
                  Può volerci mezzo minuto. La foto è in viaggio verso il fornitore.
                </p>
              ) : null}
              {choosing ? (
                <p className={ui.hint}>
                  Non vuoi usare l&apos;intelligenza artificiale?{" "}
                  <Link href="/app/cattura" className={ui.textLink}>
                    Aggiungi a mano
                  </Link>
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
                  <strong>Sono stime.</strong> Letto da {providerName} dalla foto: nomi, quantità, categorie e luoghi possono essere sbagliati. Correggi ciò che serve: solo le
                  righe che lasci spuntate entrano nel registro.
                </p>
                <p className={ui.hint}>
                  Questa lettura: {result.usage.inputTokens.toLocaleString("it-IT")} token in ingresso, {result.usage.outputTokens.toLocaleString("it-IT")} in uscita
                  {cost ? `, costo stimato ${cost}` : ""}.
                  {result.usageEstimated ? " Il fornitore non ha indicato i token usati: ho contato una stima prudente (per eccesso), non un dato esatto." : ""}
                </p>
              </div>

              {check?.status === "ok" ? (
                <p className={ui.hint} role="status">
                  Il totale torna: le righe sommano {formatPrice(check.sumCents - check.generalDiscountsCents)}, come lo scontrino.
                </p>
              ) : null}
              {check?.status === "mismatch" ? (
                <div className={ui.calloutStrong} role="alert">
                  <p className={ui.paragraph}>
                    <strong>Il totale non torna.</strong> Le righe sommano {formatPrice(check.sumCents - check.generalDiscountsCents)}, lo scontrino dice {formatPrice(check.totalCents)} (
                    {check.differenceCents > 0 ? "le righe superano il totale" : "mancano"} {formatPrice(Math.abs(check.differenceCents))}).
                    {check.linesWithoutPrice > 0 ? ` ${check.linesWithoutPrice} righe sono senza prezzo.` : ""} Può mancare una riga o essere sbagliato un prezzo: confronta con lo scontrino.
                  </p>
                </div>
              ) : null}
              {check?.status === "no_total" ? <p className={ui.hint}>Il totale dello scontrino non si leggeva: non posso controllare la somma.</p> : null}

              {warnings.length > 0 ? (
                <div className={ui.callout}>
                  <p className={ui.paragraph}>
                    <strong>Da controllare</strong>
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
              {infos.length > 0 ? (
                <details className={styles.notes}>
                  <summary>Note della lettura ({infos.length})</summary>
                  <ul className={ui.bullets}>
                    {infos.map((p, i) => (
                      <li key={`${p.code}-${i}`} className={ui.hint}>
                        {p.message}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              <section className={ui.section}>
                <SectionHeader label="Scontrino" />
                <div className={styles.meta}>
                  <div className={ui.field}>
                    <label className={ui.fieldLabel} htmlFor={`${ids}-store`}>
                      Negozio <span className={ui.optional}>(facoltativo)</span>
                    </label>
                    <input
                      id={`${ids}-store`}
                      className={ui.input}
                      type="text"
                      value={storeName}
                      onChange={(e) => setStoreName(e.target.value)}
                      onBlur={() => void onStoreBlur()}
                      autoComplete="off"
                    />
                    {entryCount(memory.row) > 0 ? (
                      <Button variant="text" onClick={() => void onForget()}>
                        {memory.storeKey === "" ? "Dimentica ciò che ho imparato" : "Dimentica ciò che ho imparato per questo negozio"}
                      </Button>
                    ) : null}
                  </div>
                  <div className={ui.field}>
                    <label className={ui.fieldLabel} htmlFor={`${ids}-date`}>
                      Data
                    </label>
                    <input id={`${ids}-date`} className={ui.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                    <p className={ui.hint}>Se la lasci vuota vale oggi.</p>
                  </div>
                </div>
              </section>

              <section className={ui.section}>
                <SectionHeader label={`Righe (${lines.length})`} />
                {lines.length === 0 ? (
                  <div className={ui.empty}>
                    <h2 className={ui.emptyTitle}>Nessuna riga letta</h2>
                    <p className={ui.emptyText}>La foto potrebbe essere sfocata o tagliata. Prova con un&apos;altra, oppure aggiungi gli alimenti a mano.</p>
                  </div>
                ) : (
                  <ul className={styles.rows}>
                    {lines.map((line) => (
                      <ReviewRow
                        key={line.key}
                        idBase={ids}
                        line={line}
                        error={rowErrors[line.key]}
                        onChange={(patch) => updateLine(line.key, patch)}
                        onUseRemembered={() => adoptLineMemory(line.key)}
                        onStopIgnoring={() => void onStopIgnoring(line.key)}
                      />
                    ))}
                  </ul>
                )}
              </section>

              {fromMemory > 0 ? (
                <p className={ui.hint}>
                  {fromMemory === 1 ? "Una riga è come l'ultima volta" : `${fromMemory} righe sono come l'ultima volta`}: sono già compilate, correggile se serve.
                </p>
              ) : null}
              {chosen.length > 0 ? (
                <p className={ui.hint}>
                  Righe scelte: {chosen.length}, per {formatPrice(includedTotalCents(lines))}.
                </p>
              ) : null}
              {formError ? (
                <p className={ui.error} role="alert">
                  {formError}
                </p>
              ) : null}
              <div className={ui.row}>
                <Button onClick={onSave} disabled={busy !== null || chosen.length === 0}>
                  {busy === "saving" ? "Salvo…" : chosen.length === 1 ? "Salva 1 alimento" : `Salva ${chosen.length} alimenti`}
                </Button>
                <Button variant="outline" onClick={startOver} disabled={busy !== null}>
                  Scarta e ricomincia
                </Button>
              </div>
              <p className={ui.hint}>Gli alimenti entrano come acquisti stimati, con prezzo e negozio dello scontrino.</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
