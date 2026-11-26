"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { formatCost, isAiError, usageForMonth } from "@/core/ai";
import type { ExpiryChoice } from "@/core/ai/receiptExpiry";
import { emptyMemory, entryCount, normalizeStoreKey, type LoadedMemory } from "@/core/ai/receiptMemory";
import { derivePantry, generateId, isCalendarDate } from "@/core/ledger";
import { appendEvents, getAllEvents, getDeviceId } from "@/data";
import { Button, Label, SectionHeader } from "@/design";
import { ActionBar, Disclosure } from "../common";
import { dayOf, formatCalendarDate, formatPrice } from "../format";
import { useNotice } from "../notice";
import { useNow } from "../useNow";
import ui from "../ui.module.css";
import { activeModel, configIssue, destinationHost, dexieSettingsStore, type AiSettings } from "./settings";
import { IMAGE_ERROR_MESSAGES, ImageError, prepareImage, type PreparedImage } from "./image";
import { describeAiError } from "./messages";
import { NotReady } from "./NotReady";
import { PROVIDER_LABELS } from "./providers/types";
import { readReceipt, type ReceiptReadResult } from "./readReceipt";
import {
  buildDraft,
  createDraftWriter,
  draftSummary,
  excludeWritten,
  leftOutText,
  mergeWritten,
  nothingLeftText,
  pendingLines,
  receiptIdGenerator,
  reviewWithout,
  settleSave,
  splitForSave,
  useReceiptDraft,
  writtenReceipt,
  type LedgerView,
  type ReceiptDraft,
  type WrittenReceipt,
} from "./receiptDraft";
import { buildReceiptEvents, purchaseInstant, storeLabel, toReviewLines, type ReviewLine } from "./receiptEvents";
import { applyMemory, reapplyMemory, adoptRemembered } from "./receiptLearning";
import { forgetIgnore, forgetMemory, loadMemory, rememberReceipt, restoreMemory } from "./receiptMemoryStore";
import type { LinePatch } from "./receiptProduct";
import { doubtsOf, reviewLayout, reviewStatus, type ReviewLayout } from "./receiptReview";
import { ReviewRow } from "./ReviewRow";
import { useAiSettings } from "./useAiSettings";
import styles from "./ReceiptCapture.module.css";

const formatBytes = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1000))} kB`);

/** Uno scontrino lungo si fotografa a pezzi: fino a quattro, letti insieme in una sola richiesta. */
const MAX_PHOTOS = 4;

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

/**
 * `?riprendi=1` (da «Riprendi» in Dispensa): la revisione riparte senza un secondo tocco. Il parametro si legge una volta
 * e si toglie dall'indirizzo. Sta in un suo confine di Suspense perché la pagina non ne ha uno.
 */
function ResumeRequest({ ready, onResume }: { ready: boolean; onResume: () => unknown }) {
  const wanted = useSearchParams().get("riprendi") !== null;
  useEffect(() => {
    if (!wanted || !ready) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("riprendi");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    void onResume();
  }, [wanted, ready, onResume]);
  return null;
}

type Busy = "preparing" | "reading" | "saving" | "resuming" | null;

/** Una foto tenuta solo in memoria, finché la pagina è aperta: non si conserva da nessuna parte. */
interface Photo {
  id: number;
  prepared: PreparedImage;
}

/** Il registro riletto: quali eventi ci sono e quali sono stati annullati. */
async function readLedger(): Promise<LedgerView> {
  const events = await getAllEvents();
  return { written: new Set(events.map((e) => e.id)), voided: new Set(derivePantry(events).voidedEventIds) };
}

const photosKey = (photos: readonly Photo[]) => photos.map((p) => p.id).join(",");
const EMPTY_LAYOUT: ReviewLayout = { order: [], excluded: [] };

function Reader({ settings }: { settings: AiSettings }) {
  const ids = useId();
  const now = useNow();
  const notice = useNotice();
  const abortRef = useRef<AbortController | null>(null);
  const photoId = useRef(0);
  // un secondo tocco su «Aggiungi alla dispensa» prima che lo stato si aggiorni non scrive di nuovo
  const savingRef = useRef(false);
  // la riga da portare in vista dopo un salvataggio non riuscito
  const focusRef = useRef<{ key: string; field: "name" | "expiry" } | null>(null);
  // le righe com'erano appena lette, prima della memoria: servono a rileggere la memoria se cambia il negozio
  const baseRef = useRef<ReviewLine[]>([]);
  // la bozza: scritta sul telefono mentre si rivede (`receiptDraft.ts`), fuori dal registro
  const [writer] = useState(() => createDraftWriter());
  const readingIdRef = useRef("");
  const readAtRef = useRef("");
  // righe già scritte nel registro da un salvataggio parziale: non stanno più tra le righe da rivedere
  const savedKeysRef = useRef<string[]>([]);
  const resumingRef = useRef(false);
  // le firme delle righe già scritte da questa lettura: una lettura nuova dello stesso scontrino non le riscrive
  const writtenRef = useRef<WrittenReceipt | null>(null);

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [readPhotos, setReadPhotos] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReceiptReadResult | null>(null);
  const [readingNo, setReadingNo] = useState(0);
  const [lines, setLines] = useState<ReviewLine[]>([]);
  const [layout, setLayout] = useState<ReviewLayout>(EMPTY_LAYOUT);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [storeName, setStoreName] = useState("");
  const [date, setDate] = useState("");
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [expiryErrors, setExpiryErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [memory, setMemory] = useState<LoadedMemory>(emptyMemory);
  // quante righe di questa lettura sono state lasciate fuori perché già scritte da una lettura dello stesso scontrino
  const [leftOut, setLeftOut] = useState(0);
  const { draft: stored, ready: draftReady } = useReceiptDraft(now);

  useEffect(() => () => abortRef.current?.abort(), []);

  // uscendo dalla pagina o con l'app che va in secondo piano, ciò che è in attesa si scrive subito
  useEffect(() => {
    const flush = () => void writer.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [writer]);

  // a ogni cambio della revisione la bozza si riscrive, dopo mezzo secondo senza altri cambi
  useEffect(() => {
    if (result === null || readingIdRef.current === "") return;
    writer.schedule(
      buildDraft(
        { readingId: readingIdRef.current, readAt: readAtRef.current, result, lines, layout, open, storeName, date, readingNo, savedLineIds: savedKeysRef.current },
        new Date(),
      ),
    );
  }, [writer, result, lines, layout, open, storeName, date, readingNo]);

  // dopo un salvataggio fermato da un errore: la prima riga sbagliata, ora aperta, in vista e con il cursore nel campo
  useEffect(() => {
    const target = focusRef.current;
    if (!target) return;
    focusRef.current = null;
    document.getElementById(`${ids}-${target.key}-row`)?.scrollIntoView({ block: "center" });
    const field = document.getElementById(`${ids}-${target.key}-${target.field}`) ?? document.getElementById(`${ids}-${target.key}-name`);
    field?.focus({ preventScroll: true });
  });

  const providerName = PROVIDER_LABELS[settings.provider];
  const model = activeModel(settings);
  const host = destinationHost(settings);
  const month = now ? usageForMonth(settings.usage, now) : null;
  const today = now ? dayOf(now) : null;

  function clearResult() {
    setResult(null);
    setLines([]);
    setLayout(EMPTY_LAYOUT);
    setOpen({});
    setRowErrors({});
    setExpiryErrors({});
    setFormError(null);
    setReadPhotos(null);
    setLeftOut(0);
    readingIdRef.current = "";
    readAtRef.current = "";
    savedKeysRef.current = [];
  }

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0 || busy) return;
    setError(null);
    setDone(null);
    setBusy("preparing");
    try {
      const room = Math.max(0, MAX_PHOTOS - photos.length);
      const added: Photo[] = [];
      for (const file of files.slice(0, room)) {
        added.push({ id: ++photoId.current, prepared: await prepareImage(file) });
      }
      setPhotos((all) => [...all, ...added].slice(0, MAX_PHOTOS));
      if (files.length > room) setError(`Al massimo ${MAX_PHOTOS} foto per scontrino: ne ho tenute ${photos.length + added.length}.`);
    } catch (e) {
      setError(IMAGE_ERROR_MESSAGES[e instanceof ImageError ? e.kind : "decode"]);
    } finally {
      setBusy(null);
    }
  }

  function removePhoto(id: number) {
    if (busy) return;
    setPhotos((all) => all.filter((p) => p.id !== id));
  }

  async function onRead() {
    if (photos.length === 0 || busy) return;
    const sent = photos;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setDone(null);
    clearResult();
    setBusy("reading");
    try {
      // una sola richiesta con tutte le foto, nell'ordine in cui sono state fatte
      const out = await readReceipt({
        store: dexieSettingsStore(),
        images: sent.map((p) => p.prepared.image),
        today: dayOf(new Date().toISOString()),
        signal: controller.signal,
      });
      const name = storeLabel(out.reading);
      const base = toReviewLines(out.reading);
      const learned = await loadMemory(name);
      // le righe uguali a quelle già scritte dalla bozza di prima (una nuova lettura dello stesso scontrino) tornano spente
      const guarded = excludeWritten(base.map((l) => applyMemory(l, learned)), writtenRef.current, out.reading);
      const next = guarded.lines;
      // un altro scontrino: niente si spegne e ciò che si ricordava delle righe scritte si dimentica
      if (!guarded.same) writtenRef.current = null;
      const arranged = reviewLayout(next);
      const opened = Object.fromEntries(next.filter((l) => doubtsOf(l).length > 0).map((l) => [l.key, true]));
      const readingId = generateId();
      const readAt = new Date().toISOString();
      baseRef.current = base;
      readingIdRef.current = readingId;
      readAtRef.current = readAt;
      savedKeysRef.current = [];
      setMemory(learned);
      setLeftOut(guarded.excluded);
      setResult(out);
      setReadPhotos(photosKey(sent));
      setReadingNo(readingNo + 1);
      setLines(next);
      setLayout(arranged);
      setOpen(opened);
      setStoreName(name);
      setDate(out.reading.date ?? "");
      // la lettura è pagata: la bozza si scrive subito, prima di ogni altro tocco, e prende il posto di una vecchia
      void writer.writeNow(
        buildDraft({ readingId, readAt, result: out, lines: next, layout: arranged, open: opened, storeName: name, date: out.reading.date ?? "", readingNo: readingNo + 1 }, new Date(readAt)),
      );
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

  // una riga esclusa accesa a mano passa tra le righe da aggiungere, in cima e aperta
  function promote(key: string) {
    if (!layout.excluded.includes(key)) return;
    setLayout((l) => ({ order: [key, ...l.order.filter((k) => k !== key)], excluded: l.excluded.filter((k) => k !== key) }));
    setOpen((o) => ({ ...o, [key]: true }));
  }

  function updateLine(key: string, patch: LinePatch) {
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch, touched: true } : l)));
    if (rowErrors[key]) setRowErrors((e) => ({ ...e, [key]: "" }));
    if (patch.include === true) promote(key);
  }

  // la scadenza non è una correzione della riga: non tocca ciò che la memoria ha proposto
  function setLineExpiry(key: string, choice: ExpiryChoice | undefined) {
    setLines((all) => all.map((l) => (l.key === key ? { ...l, expiry: choice } : l)));
    if (expiryErrors[key]) setExpiryErrors((e) => ({ ...e, [key]: "" }));
  }

  function adoptLineMemory(key: string) {
    const line = lines.find((l) => l.key === key);
    setLines((all) => all.map((l) => (l.key === key ? adoptRemembered(l) : l)));
    if (line && adoptRemembered(line).include) promote(key);
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

  async function onStopIgnoring(key: string) {
    const line = lines.find((l) => l.key === key);
    updateLine(key, { ignoreAlways: false });
    if (!line?.memoryKey) return;
    setMemory(await forgetIgnore(memory.storeKey, line.memoryKey));
  }

  function startOver() {
    abortRef.current?.abort();
    setPhotos([]);
    setError(null);
    clearResult();
    setMemory(emptyMemory());
    baseRef.current = [];
    writtenRef.current = null;
  }

  /** Toglie la bozza e dice come rimetterla: «Scarta» è lo stesso verbo in ogni punto dello scontrino. */
  async function dropDraft(draft: ReceiptDraft | null) {
    await writer.clear();
    if (draft === null) return;
    notice.show({ message: "Scontrino scartato.", onUndo: () => writer.writeNow(draft) });
  }

  function snapshot(): ReceiptDraft | null {
    if (result === null || readingIdRef.current === "") return null;
    return buildDraft(
      { readingId: readingIdRef.current, readAt: readAtRef.current, result, lines, layout, open, storeName, date, readingNo, savedLineIds: savedKeysRef.current },
      new Date(),
    );
  }

  async function discardReview() {
    const draft = snapshot();
    // la bozza si toglie prima di uscire dalla revisione: così la proposta non lampeggia
    await writer.clear();
    startOver();
    if (draft !== null) notice.show({ message: "Scontrino scartato.", onUndo: () => writer.writeNow(draft) });
  }

  /** «Riprendi»: la revisione com'era, senza foto e senza chiedere niente al fornitore. Il registro non si tocca. */
  async function resume(draft: ReceiptDraft) {
    if (resumingRef.current || busy !== null || result !== null) return;
    resumingRef.current = true;
    setBusy("resuming");
    setError(null);
    try {
      // le righe già nel registro (un salvataggio interrotto) non tornano tra quelle da salvare
      const rest = pendingLines(draft, await readLedger());
      if (rest.lines.length === 0) {
        await writer.clear();
        setDone(nothingLeftText(rest.inPantry, rest.removed.length));
        return;
      }
      const learned = await loadMemory(draft.storeName);
      baseRef.current = toReviewLines(draft.result.reading);
      readingIdRef.current = draft.readingId;
      readAtRef.current = draft.readAt;
      savedKeysRef.current = rest.saved;
      writtenRef.current = writtenReceipt(draft.result.reading, baseRef.current, rest.saved);
      setLeftOut(0);
      setMemory(learned);
      setPhotos([]);
      setDone(null);
      setRowErrors({});
      setExpiryErrors({});
      setFormError(null);
      setResult(draft.result);
      // stringa vuota e non null: con null le foto risulterebbero cambiate
      setReadPhotos("");
      setReadingNo(draft.readingNo);
      setLines(rest.lines);
      setLayout(rest.layout);
      setOpen(rest.open);
      setStoreName(draft.storeName);
      setDate(draft.date);
    } catch {
      setError("Non sono riuscito a riprendere lo scontrino. Riprova.");
    } finally {
      resumingRef.current = false;
      setBusy(null);
    }
  }

  async function onSave() {
    if (!result || busy || savingRef.current) return;
    savingRef.current = true;
    setBusy("saving");
    setFormError(null);
    try {
      const at = new Date().toISOString();
      const readingId = readingIdRef.current;
      // il registro si rilegge prima di scrivere: una riga già scritta (un salvataggio interrotto) non si riscrive
      const { already, removed, todo, toSave } = splitForSave(lines, readingId, await readLedger());
      if (toSave.length === 0 && already.length + removed.length > 0) {
        await writer.clear();
        startOver();
        setDone(nothingLeftText(already.length, removed.length));
        return;
      }
      const built = buildReceiptEvents(
        todo,
        { store: storeName, date },
        { now: at, deviceId: await getDeviceId(), idGenerator: receiptIdGenerator(readingId, toSave.map((l) => l.key)) },
      );
      if (!built.ok) {
        const wrongExpiry = built.expiryErrors ?? {};
        setRowErrors(built.errors);
        setExpiryErrors(wrongExpiry);
        setFormError(built.form ?? "Controlla le righe segnate: manca qualcosa.");
        const wrong = new Set([...Object.keys(built.errors), ...Object.keys(wrongExpiry)]);
        setOpen((o) => ({ ...o, ...Object.fromEntries([...wrong].map((k) => [k, true])) }));
        const first = [...layout.order, ...layout.excluded].find((k) => wrong.has(k));
        if (first) focusRef.current = { key: first, field: built.errors[first] ? "name" : "expiry" };
        return;
      }
      // una sola scrittura per tutto lo scontrino, scadenze comprese: una riga in «Ultime azioni»
      const written = await appendEvents(built.events);
      // l'evento i è della riga i tra le scelte: `rejected` dice quali non sono entrate
      const settled = settleSave(toSave, written.rejected.map((r) => r.index));
      const rejectedAt = new Set(written.rejected.map((r) => r.index));
      const savedEvents = built.events.filter((_, i) => !rejectedAt.has(i));
      if (savedEvents.length === 0) {
        setFormError("Non sono riuscito a salvare. Riprova.");
        return;
      }
      const rejectedKeys = settled.rejected.map((l) => l.key);
      const rejectedSet = new Set(rejectedKeys);
      const learned = await rememberReceipt(storeName, lines.filter((l) => !rejectedSet.has(l.key)), at);
      const before = { storeName, row: learned.before.row };
      notice.show({
        message: `${savedEvents.length === 1 ? "Aggiunto" : "Aggiunti"} alla dispensa: ${
          rejectedKeys.length === 0 ? built.summary : `${savedEvents.length} ${savedEvents.length === 1 ? "alimento" : "alimenti"}${storeName.trim() !== "" ? ` da ${storeName.trim()}` : ""}`
        }.`,
        undo: savedEvents,
        // «Annulla» toglie gli alimenti e rimette la memoria com'era prima di questo scontrino
        onUndo: async () => {
          try {
            await restoreMemory(before.storeName, before.row);
          } catch {
            // la memoria è un aiuto: gli alimenti si tolgono lo stesso
          }
        },
        link: { label: "Vedi", href: "/app/dispensa" },
      });
      if (rejectedKeys.length === 0) {
        const total = savedEvents.length + already.length;
        await writer.clear();
        startOver();
        setDone(`Fatto: ${total === 1 ? "1 alimento" : `${total} alimenti`} in dispensa.`);
        return;
      }
      // salvataggio parziale: le righe entrate escono dalla revisione, quelle respinte restano, e anche nella bozza
      const doneKeys = new Set([...settled.saved, ...already, ...removed].map((l) => l.key));
      const next = reviewWithout({ lines, layout, open }, doneKeys, rejectedKeys);
      const nextLines = next.lines;
      const nextLayout = next.layout;
      const nextOpen = next.open;
      savedKeysRef.current = [...new Set([...savedKeysRef.current, ...doneKeys])];
      // le foto restano quelle di prima: una lettura nuova riscriverebbe le righe già entrate. Si torna allo stato di «Riprendi».
      writtenRef.current = mergeWritten(writtenRef.current, writtenReceipt(result.reading, baseRef.current, settled.saved.map((l) => l.key)));
      setPhotos([]);
      setReadPhotos("");
      setLines(nextLines);
      setLayout(nextLayout);
      setOpen(nextOpen);
      setRowErrors(Object.fromEntries(rejectedKeys.map((k) => [k, "Non riesco a salvare questa riga. Controlla i campi e riprova."])));
      setFormError(
        `${rejectedKeys.length === 1 ? "1 riga non è stata salvata" : `${rejectedKeys.length} righe non sono state salvate`}: ${rejectedKeys.length === 1 ? "la trovi" : "le trovi"} qui sotto. Le altre sono già in dispensa.`,
      );
      focusRef.current = { key: rejectedKeys[0], field: "name" };
      void writer.writeNow(
        buildDraft(
          { readingId, readAt: readAtRef.current, result, lines: nextLines, layout: nextLayout, open: nextOpen, storeName, date, readingNo, savedLineIds: savedKeysRef.current },
          new Date(),
        ),
      );
    } catch {
      setFormError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      savingRef.current = false;
      setBusy(null);
    }
  }

  const byKey = new Map(lines.map((l) => [l.key, l]));
  const chosen = lines.filter((l) => l.include);
  const check = result?.check;
  const warnings = result?.reading.problems.filter((p) => p.severity === "warning") ?? [];
  const infos = result?.reading.problems.filter((p) => p.severity === "info") ?? [];
  const cost = result && result.cost !== null ? formatCost(result.cost, result.currency) : null;
  const photosChanged = result !== null && readPhotos !== photosKey(photos);
  const purchaseAt = now ? purchaseInstant(date, now) : "";
  const placed = new Set([...layout.order, ...layout.excluded]);
  const mainKeys = [...layout.order, ...lines.filter((l) => !placed.has(l.key)).map((l) => l.key)];
  const excludedLines = layout.excluded.map((k) => byKey.get(k)).filter((l): l is ReviewLine => l !== undefined);
  // la proposta: solo nella fase delle foto, e mai mentre si legge. La revisione ancora viva in pagina non si ripropone.
  const offer = result === null && busy === null && draftReady ? stored : undefined;
  const photoBytes = photos.reduce((sum, p) => sum + p.prepared.blob.size, 0);

  function renderRow(line: ReviewLine) {
    return (
      <ReviewRow
        key={line.key}
        idBase={ids}
        line={line}
        error={rowErrors[line.key] || undefined}
        expiryError={expiryErrors[line.key] || undefined}
        open={open[line.key] === true}
        onOpenChange={(next) => setOpen((o) => ({ ...o, [line.key]: next }))}
        purchaseAt={purchaseAt}
        today={today}
        onChange={(patch) => updateLine(line.key, patch)}
        onExpiry={(choice) => setLineExpiry(line.key, choice)}
        onConfirmCategory={() => setLines((all) => all.map((l) => (l.key === line.key ? { ...l, categoryChecked: true } : l)))}
        onUseRemembered={() => adoptLineMemory(line.key)}
        onStopIgnoring={() => void onStopIgnoring(line.key)}
      />
    );
  }

  const photoList =
    photos.length > 0 ? (
      <ol className={styles.thumbs} aria-label="Foto dello scontrino">
        {photos.map((p, i) => (
          <li key={p.id} className={styles.thumb}>
            {/* anteprima locale dell'immagine già ridotta: non passa da next/image */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:${p.prepared.image.mediaType};base64,${p.prepared.image.dataBase64}`} alt={`Foto ${i + 1} dello scontrino, quella che verrà inviata`} />
            <span className={styles.thumbNumber}>{i + 1}</span>
            <Button variant="text" onClick={() => removePhoto(p.id)} disabled={busy !== null} aria-label={`Togli la foto ${i + 1}`}>
              Togli
            </Button>
          </li>
        ))}
      </ol>
    ) : null;

  const addPhoto =
    photos.length > 0 && photos.length < MAX_PHOTOS ? (
      <div className={styles.pick}>
        <label className={styles.file}>
          <input type="file" accept="image/*" multiple onChange={onFiles} disabled={busy !== null} />
          <span>Aggiungi un&apos;altra foto</span>
        </label>
      </div>
    ) : null;

  const howTo = <p className={ui.hint}>Scontrino lungo? Fotografalo a pezzi, dall&apos;alto in basso, lasciando una riga in comune tra una foto e l&apos;altra.</p>;

  return (
    <div className={ui.screen}>
      <Suspense fallback={null}>
        <ResumeRequest ready={draftReady && busy === null} onResume={() => (stored ? resume(stored) : undefined)} />
      </Suspense>
      <div className={ui.head}>
        <h1 className={ui.title}>Scontrino</h1>
        <Label>Con l&apos;intelligenza artificiale</Label>
      </div>

      {result === null ? (
        <>
          {offer && now ? (
            <div className={ui.callout}>
              <p className={ui.paragraph}>Hai uno scontrino a metà: {draftSummary(offer, new Date(now))}.</p>
              <div className={ui.row}>
                <Button variant="outline" onClick={() => void resume(offer)} disabled={busy !== null}>
                  Riprendi
                </Button>
                <Button variant="text" onClick={() => void dropDraft(offer)} disabled={busy !== null}>
                  Scarta
                </Button>
              </div>
            </div>
          ) : null}
          {done ? (
            <p className={ui.lead} role="status">
              {done}
            </p>
          ) : (
            <p className={ui.lead}>Fotografa lo scontrino: ti propongo gli alimenti, con quantità, categoria e luogo. Tu rivedi le righe prima che entrino in dispensa.</p>
          )}

          <div className={ui.calloutStrong} role="note">
            <p className={ui.paragraph}>
              <strong>Prima di leggere.</strong> All&apos;intelligenza artificiale vanno solo le foto (ridotte sul telefono) e la richiesta, con la tua chiave: a{" "}
              <strong>{host}</strong> ({providerName}), con il modello «{model}». Ogni lettura ha un costo sul tuo conto presso il fornitore. Se lo scontrino mostra dati
              personali (nome, carta fedeltà), coprili prima di fotografarlo.
            </p>
            {month && settings.monthlyCap !== null ? (
              <p className={ui.hint}>
                Tetto del mese: {formatCost(settings.monthlyCap, settings.currency)}; finora stimati {formatCost(month.cost, settings.currency)}.
              </p>
            ) : null}
          </div>

          {photos.length === 0 ? (
            <div className={styles.pick}>
              <label className={styles.file}>
                <input type="file" accept="image/*" capture="environment" onChange={onFiles} disabled={busy !== null} />
                <span>Scatta una foto</span>
              </label>
              <label className={styles.file}>
                <input type="file" accept="image/*" multiple onChange={onFiles} disabled={busy !== null} />
                <span>Scegli un&apos;immagine</span>
              </label>
            </div>
          ) : (
            <div className={styles.previewBox}>
              {photoList}
              <p className={ui.hint}>
                {photos.length === 1 ? "1 foto" : `${photos.length} foto`}, {formatBytes(photoBytes)}. Controlla che si leggano bene.
              </p>
              {addPhoto}
            </div>
          )}
          {howTo}
          {busy === "preparing" ? (
            <p className={ui.hint} role="status">
              Preparo la foto…
            </p>
          ) : null}
          {busy === "reading" ? (
            <p className={ui.hint} role="status">
              Può volerci mezzo minuto. {photos.length === 1 ? "La foto è in viaggio" : "Le foto sono in viaggio"} verso il fornitore.
            </p>
          ) : null}
          {photos.length === 0 ? (
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

          {photos.length > 0 ? (
            <ActionBar>
              <Button onClick={() => void onRead()} disabled={busy !== null}>
                {busy === "reading" ? "Leggo lo scontrino…" : "Leggi lo scontrino"}
              </Button>
              {busy === "reading" ? (
                <Button variant="outline" onClick={() => abortRef.current?.abort()}>
                  Ferma
                </Button>
              ) : null}
            </ActionBar>
          ) : null}
        </>
      ) : (
        <>
          {leftOut > 0 ? (
            <p className={ui.hint} role="status">
              {leftOutText(leftOut)}
            </p>
          ) : null}
          {check?.status === "mismatch" ? (
            <div className={ui.calloutStrong} role="alert">
              <p className={ui.paragraph}>
                <strong>Il totale non torna.</strong> Le righe sommano {formatPrice(check.sumCents - check.generalDiscountsCents)}, lo scontrino dice {formatPrice(check.totalCents)} (
                {check.differenceCents > 0 ? "le righe superano il totale" : "mancano"} {formatPrice(Math.abs(check.differenceCents))}).
                {check.linesWithoutPrice > 0 ? ` ${check.linesWithoutPrice} righe sono senza prezzo.` : ""} Può mancare una riga o essere sbagliato un prezzo: confronta con lo
                scontrino.
              </p>
            </div>
          ) : null}
          {check?.status === "ok" ? (
            <p className={ui.hint} role="status">
              Il totale torna: le righe sommano {formatPrice(check.sumCents - check.generalDiscountsCents)}, come lo scontrino.
            </p>
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

          <Disclosure
            key={`meta-${readingNo}`}
            title="Scontrino"
            summary={`${storeName.trim() === "" ? "Negozio non letto" : storeName.trim()} · ${isCalendarDate(date) ? formatCalendarDate(date) : "oggi"}`}
            defaultOpen={storeName.trim() === ""}
          >
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
                <input id={`${ids}-date`} className={`${ui.input} ${styles.dateInput}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                <p className={ui.hint}>Se la lasci vuota vale oggi.</p>
              </div>
            </div>
          </Disclosure>

          <Disclosure
            key={`photos-${readingNo}`}
            title="Foto e lettura"
            summary={
              photos.length === 0 && readPhotos === ""
                ? "Foto non conservate: le righe sì."
                : `${photos.length === 1 ? "1 foto" : `${photos.length} foto`}${cost ? ` · costo stimato ${cost}` : ""}${photosChanged ? " · cambiate" : ""}`
            }
          >
            {photosChanged ? (
              <p className={ui.hint} role="status">
                <strong>Hai cambiato le foto: rileggi per aggiornare le righe.</strong>
              </p>
            ) : null}
            {photoList}
            {addPhoto}
            {howTo}
            <div className={ui.row}>
              <Button variant="outline" onClick={() => void onRead()} disabled={busy !== null || photos.length === 0}>
                Leggi lo scontrino
              </Button>
            </div>
            <p className={ui.hint}>Rileggendo, le righe tornano come le legge la foto: le correzioni fatte qui si perdono.</p>
            <p className={ui.hint}>
              Questa lettura: {result.usage.inputTokens.toLocaleString("it-IT")} token in ingresso, {result.usage.outputTokens.toLocaleString("it-IT")} in uscita
              {cost ? `, costo stimato ${cost}` : ""}.
              {result.usageEstimated ? " Il fornitore non ha indicato i token usati: ho contato una stima prudente (per eccesso), non un dato esatto." : ""}
            </p>
            {infos.length > 0 ? (
              <ul className={ui.bullets}>
                {infos.map((p, i) => (
                  <li key={`${p.code}-${i}`} className={ui.hint}>
                    {p.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </Disclosure>

          <section className={ui.section}>
            <SectionHeader label={`Righe (${lines.length})`} />
            {lines.length === 0 ? (
              <div className={ui.empty}>
                <h2 className={ui.emptyTitle}>Nessuna riga letta</h2>
                <p className={ui.emptyText}>La foto potrebbe essere sfocata o tagliata. Prova con un&apos;altra, oppure aggiungi gli alimenti a mano.</p>
              </div>
            ) : (
              <>
                <p className={ui.paragraph} role="status">
                  {reviewStatus(lines, rowErrors)}
                </p>
                <p className={ui.hint}>Letto da {providerName} dalle foto: sono stime. Entrano in dispensa solo le righe accese.</p>
                {mainKeys.length > 0 ? (
                  <ul className={styles.rows}>
                    {mainKeys.map((k) => {
                      const line = byKey.get(k);
                      return line ? renderRow(line) : null;
                    })}
                  </ul>
                ) : null}
                {excludedLines.length > 0 ? (
                  <Disclosure title={`Escluse (${excludedLines.length})`} summary="Non alimentari e righe che salti">
                    <ul className={styles.plainRows}>{excludedLines.map(renderRow)}</ul>
                  </Disclosure>
                ) : null}
              </>
            )}
          </section>

          {formError ? (
            <p className={ui.error} role="alert">
              {formError}
            </p>
          ) : null}

          <ActionBar>
            <Button onClick={() => void onSave()} disabled={busy !== null || chosen.length === 0}>
              {busy === "saving" ? "Salvo…" : `Aggiungi alla dispensa (${chosen.length})`}
            </Button>
            <Button variant="outline" onClick={() => void discardReview()} disabled={busy !== null}>
              Scarta e rifai la foto
            </Button>
          </ActionBar>
        </>
      )}
    </div>
  );
}
