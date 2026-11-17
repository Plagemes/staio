"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { APP_NAME } from "@/config";
import {
  formatCost,
  isAiError,
  normalizeBaseUrl,
  normalizePriceList,
  originOf,
  parseDecimal,
  usageForMonth,
  type PriceList,
} from "@/core/ai";
import { Button, Label, SectionHeader } from "@/design";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { callAi } from "./call";
import { describeAiError } from "./messages";
import { PROVIDER_IDS, PROVIDER_LABELS, type ProviderId } from "./providers/types";
import {
  checkApiKey,
  clearApiKey,
  dexieSettingsStore,
  hostOf,
  maskKey,
  updateAiSettings,
  type AiSettings,
} from "./settings";
import { useAiSettings } from "./useAiSettings";
import styles from "./AiSettings.module.css";

interface PriceDraft {
  input: string;
  output: string;
}

interface Draft {
  provider: ProviderId;
  aKey: string;
  aModel: string;
  aCheap: string;
  aUseCheap: boolean;
  aWorkspace: string;
  oKey: string;
  oBaseUrl: string;
  oModel: string;
  oTokenParam: "max_completion_tokens" | "max_tokens";
  cap: string;
  currency: string;
  prices: Record<string, PriceDraft>;
}

const numberText = (n: number) => String(n).replace(".", ",");

function draftFrom(s: AiSettings): Draft {
  const prices: Record<string, PriceDraft> = {};
  for (const [model, p] of Object.entries(s.priceList)) {
    prices[model] = { input: numberText(p.inputPerMTok), output: numberText(p.outputPerMTok) };
  }
  return {
    provider: s.provider,
    aKey: "",
    aModel: s.anthropic.model,
    aCheap: s.anthropic.cheapModel,
    aUseCheap: s.anthropic.useCheapModel,
    aWorkspace: s.anthropic.workspaceId,
    oKey: "",
    oBaseUrl: s.openai.baseUrl,
    oModel: s.openai.model,
    oTokenParam: s.openai.tokenParam,
    cap: s.monthlyCap === null ? "" : numberText(s.monthlyCap),
    currency: s.currency,
    prices,
  };
}

/** Modelli che l'utente sta usando o può scegliere: per ognuno c'è una riga di listino. */
function modelsOf(d: Draft): string[] {
  const list = d.provider === "anthropic" ? [d.aModel, d.aCheap] : [d.oModel];
  return [...new Set(list.map((m) => m.trim()).filter((m) => m !== ""))];
}

type Status = { kind: "ok" | "error" | "info"; text: string } | null;

export function AiSettingsScreen() {
  const { settings, ready } = useAiSettings();
  if (!ready) {
    return (
      <div className={ui.screen}>
        <div className={ui.head}>
          <h1 className={ui.title}>Intelligenza artificiale</h1>
        </div>
        <p className={ui.lead} role="status">
          Carico le impostazioni…
        </p>
      </div>
    );
  }
  // il modulo parte dai valori salvati e poi è dell'utente: le chiavi digitate non si perdono se il salvataggio aggiorna `settings`
  return <AiSettingsForm settings={settings} />;
}

function AiSettingsForm({ settings }: { settings: AiSettings }) {
  const ids = useId();
  const now = useNow();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(settings));
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState<"saving" | "testing" | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const isAnthropic = draft.provider === "anthropic";
  const savedKey = isAnthropic ? settings.anthropic.apiKey : settings.openai.apiKey;
  const typedKey = isAnthropic ? draft.aKey : draft.oKey;
  const providerName = PROVIDER_LABELS[draft.provider];

  /** Convalida e salva. Se qualcosa non va scrive l'errore e restituisce false; altrimenti dice se la chiave salvata è stata scartata. */
  async function save(): Promise<false | { droppedKey: boolean }> {
    let newKey: string | undefined;
    if (typedKey.trim() !== "") {
      const check = checkApiKey(typedKey);
      if (!check.ok) {
        setStatus({ kind: "error", text: "La chiave non è valida: non deve contenere spazi né lettere accentate, ed è più lunga di così. Copiala di nuovo per intero." });
        return false;
      }
      newKey = check.key;
    }
    if (draft.provider === "openai_compatible") {
      const base = normalizeBaseUrl(draft.oBaseUrl);
      if (!base.ok) {
        const reason = {
          empty: "Scrivi l'indirizzo del servizio.",
          invalid: "L'indirizzo del servizio non è valido: deve iniziare con https://.",
          insecure: "Per proteggere la chiave, l'indirizzo deve iniziare con https:// (http:// si accetta solo per localhost).",
          credentials: "L'indirizzo non deve contenere nome utente o password.",
        }[base.error];
        setStatus({ kind: "error", text: reason });
        return false;
      }
    }
    let cap: number | null = null;
    if (draft.cap.trim() !== "") {
      const parsed = parseDecimal(draft.cap);
      if (parsed === undefined || !(parsed > 0)) {
        setStatus({ kind: "error", text: "Il tetto di spesa deve essere un numero maggiore di zero, oppure lascialo vuoto." });
        return false;
      }
      cap = parsed;
    }
    const shown = modelsOf(draft);
    const nextPrices: Record<string, { inputPerMTok: number; outputPerMTok: number }> = { ...settings.priceList };
    for (const model of shown) {
      const row = draft.prices[model];
      const hasInput = (row?.input ?? "").trim() !== "";
      const hasOutput = (row?.output ?? "").trim() !== "";
      if (!hasInput && !hasOutput) {
        delete nextPrices[model];
        continue;
      }
      const input = parseDecimal(row?.input);
      const output = parseDecimal(row?.output);
      if (input === undefined || output === undefined || input < 0 || output < 0) {
        setStatus({ kind: "error", text: `Nel listino, per «${model}» servono due numeri (ingresso e uscita), oppure lascia vuote entrambe le caselle.` });
        return false;
      }
      nextPrices[model] = { inputPerMTok: input, outputPerMTok: output };
    }
    const priceList: PriceList = normalizePriceList(nextPrices);

    setBusy((b) => b ?? "saving");
    let updated: AiSettings;
    try {
      updated = await updateAiSettings(dexieSettingsStore(), (s) => ({
        ...s,
        provider: draft.provider,
        anthropic: {
          ...s.anthropic,
          apiKey: isAnthropic && newKey ? newKey : s.anthropic.apiKey,
          model: draft.aModel.trim() || s.anthropic.model,
          cheapModel: draft.aCheap.trim() || s.anthropic.cheapModel,
          useCheapModel: draft.aUseCheap,
          workspaceId: draft.aWorkspace.trim(),
        },
        openai: {
          ...s.openai,
          apiKey: !isAnthropic && newKey ? newKey : s.openai.apiKey,
          // la chiave vale solo per l'origine per cui è stata inserita: se cambia, `updateAiSettings` la scarta
          keyOrigin: !isAnthropic && newKey ? (originOf(draft.oBaseUrl) ?? "") : s.openai.keyOrigin,
          baseUrl: draft.oBaseUrl.trim(),
          model: draft.oModel.trim(),
          tokenParam: draft.oTokenParam,
        },
        monthlyCap: cap,
        currency: draft.currency.trim(),
        priceList,
      }));
    } catch {
      setStatus({ kind: "error", text: "Non sono riuscito a salvare sul telefono. Riprova." });
      return false;
    } finally {
      setBusy((b) => (b === "saving" ? null : b));
    }
    if (newKey) set(isAnthropic ? { aKey: "" } : { oKey: "" });
    const droppedKey = settings.openai.apiKey !== "" && updated.openai.apiKey === "" && !(newKey && !isAnthropic);
    return { droppedKey };
  }

  const DROPPED_TEXT =
    "Hai cambiato l'indirizzo del servizio: per non inviare la vecchia chiave a un altro dominio l'ho cancellata. Incolla la chiave valida per il nuovo indirizzo.";

  async function onSave() {
    if (busy) return;
    setStatus(null);
    const saved = await save();
    if (!saved) return;
    setStatus(saved.droppedKey ? { kind: "error", text: DROPPED_TEXT } : { kind: "ok", text: "Impostazioni salvate su questo telefono." });
  }

  async function onTest() {
    if (busy) return;
    setStatus(null);
    setBusy("testing");
    try {
      const saved = await save();
      if (!saved) return;
      if (saved.droppedKey) {
        setStatus({ kind: "error", text: DROPPED_TEXT });
        return;
      }
      const store = dexieSettingsStore();
      const result = await callAi({
        store,
        request: {
          instructions: "Rispondi con la sola parola OK.",
          text: "Prova di collegamento.",
          images: [],
          maxOutputTokens: 128,
        },
      });
      const { usage } = result;
      const cost = result.cost === null ? "" : `, costo stimato ${formatCost(result.cost, result.currency)}`;
      setStatus({
        kind: "ok",
        text: `La chiave funziona. Ha risposto «${result.response.model}». La prova ha usato ${usage.inputTokens} token in ingresso e ${usage.outputTokens} in uscita${cost}.${result.usageEstimated ? " Il fornitore non ha indicato i token: ho contato una stima prudente." : ""}`,
      });
    } catch (error) {
      const model = draft.provider === "anthropic" ? (draft.aUseCheap ? draft.aCheap : draft.aModel) : draft.oModel;
      setStatus({
        kind: "error",
        text: isAiError(error) ? describeAiError(error, { provider: draft.provider, model }) : "La prova non è riuscita. Riprova.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function onClearKey() {
    setConfirmClear(false);
    setStatus(null);
    try {
      await clearApiKey(dexieSettingsStore(), draft.provider);
      set(isAnthropic ? { aKey: "" } : { oKey: "" });
      setStatus({ kind: "ok", text: "Chiave cancellata da questo telefono." });
    } catch {
      setStatus({ kind: "error", text: "Non sono riuscito a cancellare la chiave. Riprova." });
    }
  }

  const month = now ? usageForMonth(settings.usage, now) : null;
  const capText = settings.monthlyCap === null ? null : formatCost(settings.monthlyCap, settings.currency);
  const priceModels = modelsOf(draft);

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Intelligenza artificiale</h1>
        <Link href="/app/impostazioni" className={ui.textLink}>
          Torna alle impostazioni
        </Link>
      </div>

      <section className={ui.section} aria-labelledby={`${ids}-why`}>
        <SectionHeader label="A cosa serve" />
        <div className={styles.block}>
          <p className={ui.paragraph} id={`${ids}-why`}>
            {APP_NAME} funziona benissimo senza. Se vuoi, puoi aggiungere un aiuto: per ora legge lo scontrino da una foto e ti
            propone gli alimenti da mettere in dispensa. Ogni cosa che propone è una stima: la rivedi e la correggi tu prima che
            entri nel registro.
          </p>
          <ul className={ui.bullets}>
            <li className={ui.paragraph}>
              <strong>È facoltativa.</strong> Senza chiave, il resto dell&apos;app non cambia.
            </li>
            <li className={ui.paragraph}>
              <strong>La chiave è tua e resta su questo telefono.</strong> Non passa da nessun server di {APP_NAME}: le richieste
              partono dal telefono direttamente verso il fornitore che scegli. Non finisce nelle copie di sicurezza e la togli
              quando vuoi.
            </li>
            <li className={ui.paragraph}>
              <strong>Ogni lettura ha un costo.</strong> Lo paghi tu, sul tuo conto presso il fornitore: di solito pochi centesimi
              a scontrino, ma dipende dal modello e dalla foto. {APP_NAME} non conosce i prezzi: se vuoi vedere una stima e fissare
              un tetto, scrivili nel listino qui sotto.
            </li>
            <li className={ui.paragraph}>
              <strong>La foto parte verso il fornitore.</strong> Quando leggi uno scontrino, l&apos;immagine (ridotta) viene
              inviata a lui. Non c&apos;è altro invio: gli alimenti che registri restano sul telefono.
            </li>
          </ul>
        </div>
      </section>

      <section className={ui.section} aria-labelledby={`${ids}-provider`}>
        <SectionHeader label="Fornitore" />
        <div className={styles.block}>
          <fieldset className={ui.field}>
            <legend className={ui.fieldLabel} id={`${ids}-provider`}>
              Con chi vuoi leggere gli scontrini
            </legend>
            <div className={ui.choices}>
              {PROVIDER_IDS.map((id) => (
                <label key={id} className={ui.choice}>
                  <input type="radio" name={`${ids}-provider`} value={id} checked={draft.provider === id} onChange={() => set({ provider: id })} />
                  <span>{PROVIDER_LABELS[id]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className={styles.guide}>
            <Label as="h3">Come ottenere una chiave</Label>
            {isAnthropic ? (
              <ol className={styles.steps}>
                <li>
                  Apri la console di Anthropic:{" "}
                  <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener noreferrer">
                    platform.claude.com/settings/keys
                  </a>
                  , e accedi o crea un account.
                </li>
                <li>Controlla che il conto abbia del credito: le chiamate sono a consumo e senza credito vengono rifiutate.</li>
                <li>
                  Nella pagina delle chiavi (API keys) scegli «Create key», dagli un nome (per esempio «{APP_NAME} sul telefono») e,
                  se la console lo permette, una scadenza.
                </li>
                <li>
                  Copia la chiave appena creata (inizia con <code>sk-ant-</code>): di solito la vedi una volta sola. Incollala qui
                  sotto e salva.
                </li>
              </ol>
            ) : (
              <ol className={styles.steps}>
                <li>
                  Serve un servizio che offra l&apos;API «Chat Completions» di OpenAI, con modelli che leggono le immagini, e che
                  consenta le richieste dal browser. Per OpenAI: {" "}
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">
                    platform.openai.com/api-keys
                  </a>
                  .
                </li>
                <li>Dalla pagina del fornitore copia tre cose: l&apos;indirizzo base dell&apos;API, il nome di un modello con visione e la chiave.</li>
                <li>Scrivile qui sotto e salva. Poi usa «Prova la chiave»: se la prova fallisce con «rete», il servizio potrebbe non accettare richieste dal browser.</li>
              </ol>
            )}
            {isAnthropic ? (
              <p className={ui.hint}>
                Alcuni account aziendali (per esempio con conservazione dei dati azzerata) non consentono le chiamate dal browser: in
                quel caso la prova della chiave lo dice.
              </p>
            ) : (
              <p className={ui.hint}>La chiave verrà inviata all&apos;indirizzo che scrivi: usa solo servizi di cui ti fidi.</p>
            )}
          </div>
        </div>
      </section>

      <section className={ui.section} aria-labelledby={`${ids}-key-title`}>
        <SectionHeader label="Chiave e modello" />
        <div className={styles.block}>
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-key`} id={`${ids}-key-title`}>
              Chiave {providerName}
            </label>
            {savedKey !== "" ? (
              <p className={ui.hint} role="status">
                Chiave salvata su questo telefono: <span className={styles.mono}>{maskKey(savedKey)}</span>. Per cambiarla, scrivine una nuova.
              </p>
            ) : (
              <p className={ui.hint}>Nessuna chiave salvata.</p>
            )}
            <p className={ui.hint}>
              La chiave verrà inviata solo a:{" "}
              <strong className={styles.mono}>{hostOf(draft.provider, draft.oBaseUrl) || "(indirizzo non valido)"}</strong>
              {isAnthropic ? "." : ". Se cambi l'indirizzo verso un altro dominio, la chiave salvata viene cancellata e va incollata di nuovo."}
            </p>
            <div className={styles.keyRow}>
              <input
                id={`${ids}-key`}
                className={ui.input}
                type={showKey ? "text" : "password"}
                value={typedKey}
                onChange={(e) => set(isAnthropic ? { aKey: e.target.value } : { oKey: e.target.value })}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={savedKey !== "" ? "Nuova chiave (facoltativo)" : "Incolla la chiave"}
              />
              <Button variant="outline" onClick={() => setShowKey((v) => !v)} aria-pressed={showKey}>
                {showKey ? "Nascondi" : "Mostra"}
              </Button>
            </div>
          </div>

          {isAnthropic ? (
            <>
              <div className={ui.field}>
                <label className={ui.fieldLabel} htmlFor={`${ids}-amodel`}>
                  Modello per la lettura
                </label>
                <input id={`${ids}-amodel`} className={ui.input} type="text" value={draft.aModel} onChange={(e) => set({ aModel: e.target.value })} autoComplete="off" autoCapitalize="none" spellCheck={false} />
              </div>
              <div className={ui.field}>
                <label className={ui.fieldLabel} htmlFor={`${ids}-acheap`}>
                  Alternativa economica
                </label>
                <input id={`${ids}-acheap`} className={ui.input} type="text" value={draft.aCheap} onChange={(e) => set({ aCheap: e.target.value })} autoComplete="off" autoCapitalize="none" spellCheck={false} />
              </div>
              <label className={ui.switch}>
                <input type="checkbox" role="switch" checked={draft.aUseCheap} onChange={(e) => set({ aUseCheap: e.target.checked })} />
                <span className={ui.switchText}>
                  Usa l&apos;alternativa economica
                  <span className={ui.hint}>Costa meno per lettura; su scontrini difficili può sbagliare di più.</span>
                </span>
              </label>
              <details className={styles.advanced}>
                <summary>Avanzate</summary>
                <div className={ui.field}>
                  <label className={ui.fieldLabel} htmlFor={`${ids}-ws`}>
                    Area di lavoro <span className={ui.optional}>(facoltativo)</span>
                  </label>
                  <input id={`${ids}-ws`} className={ui.input} type="text" value={draft.aWorkspace} onChange={(e) => set({ aWorkspace: e.target.value })} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="wrkspc_…" />
                  <p className={ui.hint}>Serve solo se la chiave non è legata a una sola area di lavoro: la console te lo chiede con un errore.</p>
                </div>
              </details>
            </>
          ) : (
            <>
              <div className={ui.field}>
                <label className={ui.fieldLabel} htmlFor={`${ids}-obase`}>
                  Indirizzo base dell&apos;API
                </label>
                <input id={`${ids}-obase`} className={ui.input} type="url" inputMode="url" value={draft.oBaseUrl} onChange={(e) => set({ oBaseUrl: e.target.value })} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="https://…/v1" />
                <p className={ui.hint}>La richiesta va a questo indirizzo seguito da /chat/completions.</p>
              </div>
              <div className={ui.field}>
                <label className={ui.fieldLabel} htmlFor={`${ids}-omodel`}>
                  Modello (con lettura delle immagini)
                </label>
                <input id={`${ids}-omodel`} className={ui.input} type="text" value={draft.oModel} onChange={(e) => set({ oModel: e.target.value })} autoComplete="off" autoCapitalize="none" spellCheck={false} />
              </div>
              <details className={styles.advanced}>
                <summary>Avanzate</summary>
                <fieldset className={ui.field}>
                  <legend className={ui.fieldLabel}>Nome del limite di risposta</legend>
                  <div className={ui.choices}>
                    {(["max_completion_tokens", "max_tokens"] as const).map((p) => (
                      <label key={p} className={ui.choice}>
                        <input type="radio" name={`${ids}-tokenparam`} value={p} checked={draft.oTokenParam === p} onChange={() => set({ oTokenParam: p })} />
                        <span>{p}</span>
                      </label>
                    ))}
                  </div>
                  <p className={ui.hint}>Se il servizio rifiuta il primo, {APP_NAME} prova da solo l&apos;altro.</p>
                </fieldset>
              </details>
            </>
          )}

          <div className={ui.row}>
            <Button onClick={onSave} disabled={busy !== null}>
              {busy === "saving" ? "Salvo…" : "Salva"}
            </Button>
            <Button variant="outline" onClick={onTest} disabled={busy !== null}>
              {busy === "testing" ? "Provo…" : "Prova la chiave"}
            </Button>
          </div>
          <p className={ui.hint}>
            «Prova la chiave» fa una chiamata minima al fornitore: costa una frazione di centesimo e non invia nessuna foto.
          </p>
          {status ? (
            <p className={status.kind === "error" ? ui.error : ui.hint} role={status.kind === "error" ? "alert" : "status"}>
              {status.text}
            </p>
          ) : null}

          {savedKey !== "" ? (
            confirmClear ? (
              <div className={ui.calloutStrong} role="group" aria-label="Conferma cancellazione della chiave">
                <p className={ui.paragraph}>
                  <strong>Cancello la chiave {providerName}?</strong> Sparisce da questo telefono. Per usarla di nuovo la dovrai incollare ancora.
                </p>
                <div className={ui.row}>
                  <button type="button" className={ui.dangerSolid} onClick={onClearKey}>
                    Sì, cancella la chiave
                  </button>
                  <Button variant="outline" onClick={() => setConfirmClear(false)}>
                    No, tienila
                  </Button>
                </div>
              </div>
            ) : (
              <div className={ui.row}>
                <button type="button" className={ui.danger} onClick={() => setConfirmClear(true)}>
                  Cancella la chiave
                </button>
              </div>
            )
          ) : null}
        </div>
      </section>

      <section className={ui.section} aria-labelledby={`${ids}-cost`}>
        <SectionHeader label="Costi e tetto" />
        <div className={styles.block}>
          <p className={ui.paragraph} id={`${ids}-cost`}>
            I prezzi li fissa il fornitore e cambiano nel tempo: copiali dal suo listino. Servono solo a darti una stima e a far
            rispettare il tetto; i conti veri sono quelli del fornitore.
          </p>
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-currency`}>
              Valuta del conto <span className={ui.optional}>(per esempio USD o EUR)</span>
            </label>
            <input id={`${ids}-currency`} className={styles.short} type="text" value={draft.currency} onChange={(e) => set({ currency: e.target.value })} autoComplete="off" autoCapitalize="characters" maxLength={8} />
          </div>
          {priceModels.length === 0 ? (
            <p className={ui.hint}>Scrivi il nome del modello qui sopra per inserirne il prezzo.</p>
          ) : (
            priceModels.map((model, i) => (
              <fieldset key={model} className={ui.field}>
                <legend className={ui.fieldLabel}>
                  Prezzo di <span className={styles.mono}>{model}</span> per milione di token
                </legend>
                <div className={styles.priceRow}>
                  <label className={ui.hint} htmlFor={`${ids}-pin-${i}`}>
                    Ingresso
                  </label>
                  <input
                    id={`${ids}-pin-${i}`}
                    className={styles.short}
                    type="text"
                    inputMode="decimal"
                    value={draft.prices[model]?.input ?? ""}
                    onChange={(e) => set({ prices: { ...draft.prices, [model]: { input: e.target.value, output: draft.prices[model]?.output ?? "" } } })}
                    autoComplete="off"
                  />
                  <label className={ui.hint} htmlFor={`${ids}-pout-${i}`}>
                    Uscita
                  </label>
                  <input
                    id={`${ids}-pout-${i}`}
                    className={styles.short}
                    type="text"
                    inputMode="decimal"
                    value={draft.prices[model]?.output ?? ""}
                    onChange={(e) => set({ prices: { ...draft.prices, [model]: { input: draft.prices[model]?.input ?? "", output: e.target.value } } })}
                    autoComplete="off"
                  />
                </div>
              </fieldset>
            ))
          )}
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-cap`}>
              Tetto di spesa mensile <span className={ui.optional}>(facoltativo)</span>
            </label>
            <input id={`${ids}-cap`} className={styles.short} type="text" inputMode="decimal" value={draft.cap} onChange={(e) => set({ cap: e.target.value })} autoComplete="off" placeholder="per esempio 2" />
            <p className={ui.hint}>
              Nella stessa valuta del listino. Raggiunto il tetto, le letture si fermano fino al mese dopo. Il tetto funziona solo se il prezzo del modello è nel listino.
            </p>
          </div>
          <div className={ui.row}>
            <Button onClick={onSave} disabled={busy !== null}>
              Salva
            </Button>
          </div>
        </div>
      </section>

      <section className={ui.section}>
        <SectionHeader label="Uso di questo mese" />
        <div className={styles.block}>
          {month === null ? (
            <p className={ui.hint}>Calcolo…</p>
          ) : (
            <dl className={styles.usage}>
              <div>
                <dt>
                  <Label>Letture e prove</Label>
                </dt>
                <dd>{month.calls}</dd>
              </div>
              <div>
                <dt>
                  <Label>Token in ingresso</Label>
                </dt>
                <dd>{month.inputTokens.toLocaleString("it-IT")}</dd>
              </div>
              <div>
                <dt>
                  <Label>Token in uscita</Label>
                </dt>
                <dd>{month.outputTokens.toLocaleString("it-IT")}</dd>
              </div>
              <div>
                <dt>
                  <Label>Costo stimato</Label>
                </dt>
                <dd>{month.calls > 0 && month.unpricedCalls === month.calls ? "—" : formatCost(month.cost, settings.currency)}</dd>
              </div>
            </dl>
          )}
          {month && month.unpricedCalls > 0 ? (
            <p className={ui.hint}>
              {month.unpricedCalls === 1 ? "Una chiamata" : `${month.unpricedCalls} chiamate`} senza prezzo nel listino: il costo è per difetto.
            </p>
          ) : null}
          {month && month.estimatedCalls > 0 ? (
            <p className={ui.hint}>
              {month.estimatedCalls === 1 ? "Una chiamata è contata" : `${month.estimatedCalls} chiamate sono contate`} con una stima prudente (per eccesso): il fornitore non ha
              dichiarato i token, oppure la richiesta si è interrotta dopo l&apos;invio.
            </p>
          ) : null}
          {capText ? <p className={ui.hint}>Tetto del mese: {capText}.</p> : null}
          <p className={ui.hint}>È una stima fatta qui dai token dichiarati dal fornitore. Il conto vero lo trovi sulla sua pagina.</p>
        </div>
      </section>
    </div>
  );
}
