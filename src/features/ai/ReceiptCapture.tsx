"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { formatCost, isAiError, usageForMonth } from "@/core/ai";
import { appendEvents, getDeviceId } from "@/data";
import { Button, Label, SectionHeader } from "@/design";
import { dayOf, formatPrice } from "../format";
import { FOOD_CATEGORY_GROUPS, FOOD_CATEGORY_LABELS, LOCATION_LABELS, LOCATION_ORDER } from "../labels";
import { useNotice } from "../notice";
import { useNow } from "../useNow";
import ui from "../ui.module.css";
import { activeModel, configIssue, destinationHost, dexieSettingsStore, type AiSettings } from "./settings";
import { IMAGE_ERROR_MESSAGES, ImageError, prepareImage, type PreparedImage } from "./image";
import { describeAiError } from "./messages";
import { PROVIDER_LABELS } from "./providers/types";
import { readReceipt, type ReceiptReadResult } from "./readReceipt";
import { buildReceiptEvents, includedTotalCents, storeLabel, toReviewLines, type ReviewLine } from "./receiptEvents";
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
  if (issue !== null) return <NotReady issue={issue} />;
  return <Reader settings={settings} />;
}

function NotReady({ issue }: { issue: NonNullable<ReturnType<typeof configIssue>> }) {
  const text =
    issue === "missing_key"
      ? "Per leggere uno scontrino da una foto serve la tua chiave personale di un fornitore di intelligenza artificiale. È facoltativa: senza, l'app funziona lo stesso e gli alimenti li aggiungi a mano."
      : issue === "missing_model"
        ? "Hai scelto il fornitore, ma manca il nome del modello da usare. Scrivilo nelle impostazioni."
        : "L'indirizzo del servizio scelto non è valido. Correggilo nelle impostazioni.";
  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Scontrino</h1>
        <Label>Con l&apos;intelligenza artificiale</Label>
      </div>
      <div className={ui.empty}>
        <h2 className={ui.emptyTitle}>{issue === "missing_key" ? "Manca la chiave" : "Impostazioni incomplete"}</h2>
        <p className={ui.emptyText}>{text}</p>
        <div className={ui.row}>
          <Button href="/app/impostazioni/ai">Vai alle impostazioni</Button>
          <Button href="/app/cattura" variant="outline">
            Aggiungi a mano
          </Button>
        </div>
      </div>
    </div>
  );
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
  const [saved, setSaved] = useState<{ count: number; skipped: number } | null>(null);

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
      setResult(out);
      setLines(toReviewLines(out.reading));
      setStoreName(storeLabel(out.reading));
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

  function updateLine(key: string, patch: Partial<ReviewLine>) {
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    if (rowErrors[key]) setRowErrors((e) => ({ ...e, [key]: "" }));
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
      notice.show({ message: `Aggiunti ${built.summary}.`, undo: built.events });
      setSaved({ count: written.added, skipped: built.events.length - written.added });
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
  }

  const chosen = lines.filter((l) => l.include);
  const check = result?.check;
  const warnings = result?.reading.problems.filter((p) => p.severity === "warning") ?? [];
  const infos = result?.reading.problems.filter((p) => p.severity === "info") ?? [];
  const cost = result && result.cost !== null ? formatCost(result.cost, result.currency) : null;
  const choosing = !image && !result;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Scontrino</h1>
        <Label>Con l&apos;intelligenza artificiale</Label>
      </div>

      {saved ? (
        <div className={ui.empty} role="status">
          <h2 className={ui.emptyTitle}>Fatto</h2>
          <p className={ui.emptyText}>
            {saved.count === 1 ? "Ho aggiunto 1 alimento" : `Ho aggiunto ${saved.count} alimenti`} alla dispensa, con la scadenza stimata dalla categoria e dal luogo. Se
            hai sbagliato, «Annulla» nell&apos;avviso in basso li toglie.
            {saved.skipped > 0 ? ` ${saved.skipped} non sono stati salvati.` : ""}
          </p>
          <div className={ui.row}>
            <Button href="/app/dispensa">Vai alla dispensa</Button>
            <Button variant="outline" onClick={startOver}>
              Leggi un altro scontrino
            </Button>
          </div>
        </div>
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
                    <input id={`${ids}-store`} className={ui.input} type="text" value={storeName} onChange={(e) => setStoreName(e.target.value)} autoComplete="off" />
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
                      <ReviewRow key={line.key} idBase={ids} line={line} error={rowErrors[line.key]} onChange={(patch) => updateLine(line.key, patch)} />
                    ))}
                  </ul>
                )}
              </section>

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

function ReviewRow({
  idBase,
  line,
  error,
  onChange,
}: {
  idBase: string;
  line: ReviewLine;
  error?: string;
  onChange: (patch: Partial<ReviewLine>) => void;
}) {
  const id = `${idBase}-${line.key}`;
  const priceText = line.priceCents !== undefined ? formatPrice(line.priceCents) : "prezzo non letto";
  const discountText = line.discountCents > 0 ? `, già scontato di ${formatPrice(line.discountCents)}` : "";
  return (
    <li className={line.include ? styles.row : `${styles.row} ${styles.rowOff}`}>
      <label className={ui.switch}>
        <input type="checkbox" role="switch" checked={line.include} onChange={(e) => onChange({ include: e.target.checked })} />
        <span className={ui.switchText}>
          {line.name}
          <span className={ui.hint}>
            {priceText}
            {discountText}
            {line.isFood ? "" : " · non alimentare"}
          </span>
        </span>
      </label>
      {line.raw !== "" ? <p className={styles.raw}>Sullo scontrino: {line.raw}</p> : null}

      {line.include ? (
        <div className={styles.fields}>
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${id}-name`}>
              Nome
            </label>
            <input
              id={`${id}-name`}
              className={ui.input}
              type="text"
              value={line.name}
              onChange={(e) => onChange({ name: e.target.value })}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
            />
          </div>
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${id}-quantity`}>
              Quantità
            </label>
            <input
              id={`${id}-quantity`}
              className={ui.input}
              type="text"
              value={line.quantityText}
              onChange={(e) => onChange({ quantityText: e.target.value, quantityGuessed: false })}
              autoComplete="off"
              autoCapitalize="none"
              aria-describedby={`${id}-quantity-hint`}
            />
            <p className={ui.hint} id={`${id}-quantity-hint`}>
              {line.quantityGuessed ? "Non c'era sullo scontrino: ho messo 1 pezzo, correggila." : "Per esempio 500 g, 1 l, 6 pz."}
            </p>
          </div>
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${id}-category`}>
              Categoria
            </label>
            <select id={`${id}-category`} className={ui.input} value={line.category} onChange={(e) => onChange({ category: e.target.value })}>
              <option value="">Scegli una categoria</option>
              {FOOD_CATEGORY_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.categories.map((c) => (
                    <option key={c} value={c}>
                      {FOOD_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <fieldset className={ui.field}>
            <legend className={ui.fieldLabel}>Dove lo metti</legend>
            <div className={ui.choices}>
              {LOCATION_ORDER.map((l) => (
                <label key={l} className={ui.choice}>
                  <input type="radio" name={`${id}-location`} value={l} checked={line.location === l} onChange={() => onChange({ location: l })} />
                  <span>{LOCATION_LABELS[l]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {error ? (
            <p className={ui.error} id={`${id}-error`}>
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
