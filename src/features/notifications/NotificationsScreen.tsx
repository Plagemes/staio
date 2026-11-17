"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { DEFAULT_TIME_ZONE, localMoment } from "@/core/diary";
import {
  EXPIRY_DAYS_OPTIONS,
  NOTICE_TYPES,
  isQuiet,
  parseClock,
  previewNotices,
  withType,
  type NoticeType,
} from "@/core/notify";
import { Button, SectionHeader } from "@/design";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { detectDevice, readPermission, requestPermission, showMessage } from "./browser";
import type { PermissionState } from "./delivery";
import { describeDevice, type DeviceInfo } from "./device";
import { NoticesList } from "./NoticesList";
import styles from "./NotificationsScreen.module.css";
import { useNotifyData, useNotifyPrefs } from "./useNotify";

const TYPE_TEXT: Record<NoticeType, { name: string; text: string }> = {
  expiry: { name: "Alimenti in scadenza", text: "Un alimento che scade oggi, domani o presto, o è scaduto da poco. Se la data è una stima lo dico." },
  prep: { name: "Preparazioni da mangiare", text: "Le porzioni cucinate che stanno per scadere." },
  supplement: { name: "Integratori", text: "Se ne prendi uno quasi ogni giorno e oggi non l'hai ancora segnato." },
  shopping: { name: "Spesa", text: "Quando, secondo i tuoi consumi, conviene fare la spesa." },
  plan: { name: "Piano", text: "Cosa cucinare oggi e la settimana prossima ancora senza piano." },
};

const DAYS_LABEL = (n: number): string => (n === 1 ? "Solo oggi e domani" : `Fino a ${n} giorni prima`);

export function NotificationsScreen() {
  const ids = useId();
  const { prefs, unavailable, update } = useNotifyPrefs();
  const data = useNotifyData();
  const now = useNow();
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void detectDevice().then((d) => alive && setDevice(d));
    return () => {
      alive = false;
    };
  }, []);

  const status = device ? describeDevice(device) : null;
  const permission: PermissionState = device?.permission ?? "default";

  const preview = useMemo(() => {
    if (!prefs || !data || !now) return null;
    try {
      return previewNotices({ ...data, now, timeZone: DEFAULT_TIME_ZONE, prefs });
    } catch {
      return [];
    }
  }, [prefs, data, now]);

  const quietNow = useMemo(() => {
    if (!prefs || !now) return false;
    const m = localMoment(now, DEFAULT_TIME_ZONE);
    return m ? isQuiet(m.minutes, prefs.quietHours) : false;
  }, [prefs, now]);

  if (!prefs) {
    return (
      <div className={ui.screen}>
        <div className={ui.head}>
          <h1 className={ui.title}>Avvisi</h1>
        </div>
        <p className={ui.lead} role="status">
          Leggo le scelte salvate…
        </p>
      </div>
    );
  }

  // Il gesto dell'utente è questo tocco: il permesso si chiede qui e in nessun altro punto.
  function onToggleEnabled(next: boolean) {
    setMessage(null);
    if (!next) {
      void update((p) => ({ ...p, enabled: false }));
      return;
    }
    const current = readPermission();
    if (current === "unsupported") {
      setMessage({ ok: false, text: "Questo dispositivo non può mostrare avvisi." });
      return;
    }
    if (current === "denied") {
      setMessage({
        ok: false,
        text: "Gli avvisi sono bloccati per questo sito. Se vuoi riattivarli, apri le impostazioni del sito nel browser. Non te lo chiederò di nuovo.",
      });
      return;
    }
    if (current === "granted") {
      void update((p) => ({ ...p, enabled: true }));
      return;
    }
    setBusy(true);
    void requestPermission().then(async (result) => {
      setBusy(false);
      setDevice((d) => (d ? { ...d, permission: result } : d));
      if (result === "granted") {
        await update((p) => ({ ...p, enabled: true }));
      } else if (result === "denied") {
        setMessage({ ok: false, text: "Non hai concesso il permesso, quindi non ti mando avvisi. Puoi cambiare idea quando vuoi da qui." });
      } else {
        setMessage({ ok: false, text: "Il permesso non è stato dato. Gli avvisi restano spenti." });
      }
    });
  }

  async function onTest() {
    setMessage(null);
    setBusy(true);
    try {
      await showMessage({
        tag: "avvisi-prova",
        title: "Prova",
        body: "Gli avvisi funzionano su questo dispositivo.",
        url: "/app/impostazioni/avvisi",
        keys: [],
        count: 0,
        digest: false,
      });
      setMessage({ ok: true, text: "Avviso di prova inviato. Se non lo vedi, controlla le impostazioni del telefono." });
    } catch {
      setMessage({ ok: false, text: "Non sono riuscito a mostrare l'avviso di prova." });
    } finally {
      setBusy(false);
    }
  }

  const clockInvalid = parseClock(prefs.quietHours.from) === undefined || parseClock(prefs.quietHours.to) === undefined;
  const granted = permission === "granted";
  const previewNote = !prefs.enabled
    ? "Gli avvisi sono spenti: questa è solo un'anteprima."
    : quietNow
      ? `Adesso sei nelle ore di silenzio: li vedresti dopo le ${prefs.quietHours.to}.`
      : !granted
        ? "Manca il permesso del telefono: per ora non ti arriva nulla."
        : null;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Avvisi</h1>
        <Link href="/app/impostazioni" className={ui.textLink}>
          Impostazioni
        </Link>
      </div>

      <section className={ui.section} aria-labelledby={`${ids}-device`}>
        <SectionHeader label="Su questo dispositivo" />
        <div className={styles.block} id={`${ids}-device`}>
          {status ? (
            <>
              <p className={ui.paragraph}>{status.headline}</p>
              {status.details.map((d) => (
                <p key={d} className={ui.hint}>
                  {d}
                </p>
              ))}
            </>
          ) : (
            <p className={ui.hint}>Controllo cosa può fare il dispositivo…</p>
          )}
        </div>
      </section>

      <section className={ui.section} aria-labelledby={`${ids}-on`}>
        <SectionHeader label="Avvisi" />
        <div className={styles.block}>
          <label className={ui.switch} id={`${ids}-on`}>
            <input
              type="checkbox"
              role="switch"
              checked={prefs.enabled}
              disabled={busy}
              onChange={(e) => onToggleEnabled(e.target.checked)}
            />
            <span className={ui.switchText}>Avvisami</span>
          </label>
          <p className={ui.hint}>Gli avvisi non si ripetono: ogni cosa te la dico una volta. Se sono più di una, ricevi un solo riepilogo.</p>
          {message ? (
            <p className={message.ok ? ui.hint : ui.error} role={message.ok ? "status" : "alert"}>
              {message.text}
            </p>
          ) : null}
          {unavailable ? <p className={ui.error}>L&apos;archivio di questo dispositivo non è disponibile: le scelte non vengono ricordate.</p> : null}
          {prefs.enabled && granted ? (
            <Button variant="outline" onClick={onTest} disabled={busy}>
              Mostra un avviso di prova
            </Button>
          ) : null}
        </div>
      </section>

      <section className={ui.section} aria-labelledby={`${ids}-types`}>
        <SectionHeader label="Cosa ti avviso" />
        <fieldset className={styles.fieldset}>
          <legend className={ui.srOnly} id={`${ids}-types`}>
            Tipi di avviso
          </legend>
          {NOTICE_TYPES.map((t) => (
            <label key={t} className={ui.switch}>
              <input type="checkbox" role="switch" checked={prefs.types[t]} onChange={(e) => void update((p) => withType(p, t, e.target.checked))} />
              <span className={ui.switchText}>
                {TYPE_TEXT[t].name}
                <span className={ui.hint}>{TYPE_TEXT[t].text}</span>
              </span>
            </label>
          ))}
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-days`}>
              Scadenze: da quando avvisare
            </label>
            <select
              id={`${ids}-days`}
              className={ui.input}
              value={prefs.expiryDaysAhead}
              onChange={(e) => void update((p) => ({ ...p, expiryDaysAhead: Number(e.target.value) }))}
            >
              {EXPIRY_DAYS_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {DAYS_LABEL(n)}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
      </section>

      <section className={ui.section} aria-labelledby={`${ids}-quiet`}>
        <SectionHeader label="Ore di silenzio" />
        <div className={styles.block}>
          <label className={ui.switch} id={`${ids}-quiet`}>
            <input
              type="checkbox"
              role="switch"
              checked={prefs.quietHours.enabled}
              onChange={(e) => void update((p) => ({ ...p, quietHours: { ...p.quietHours, enabled: e.target.checked } }))}
            />
            <span className={ui.switchText}>Niente avvisi in queste ore</span>
          </label>
          <div className={ui.row}>
            <div className={ui.field}>
              <label className={ui.fieldLabel} htmlFor={`${ids}-from`}>
                Dalle
              </label>
              <input
                id={`${ids}-from`}
                type="time"
                className={ui.input}
                value={prefs.quietHours.from}
                disabled={!prefs.quietHours.enabled}
                onChange={(e) => e.target.value && void update((p) => ({ ...p, quietHours: { ...p.quietHours, from: e.target.value } }))}
              />
            </div>
            <div className={ui.field}>
              <label className={ui.fieldLabel} htmlFor={`${ids}-to`}>
                Alle
              </label>
              <input
                id={`${ids}-to`}
                type="time"
                className={ui.input}
                value={prefs.quietHours.to}
                disabled={!prefs.quietHours.enabled}
                onChange={(e) => e.target.value && void update((p) => ({ ...p, quietHours: { ...p.quietHours, to: e.target.value } }))}
              />
            </div>
          </div>
          {clockInvalid ? <p className={ui.error}>Orario non valido.</p> : null}
          <p className={ui.hint}>Se il silenzio attraversa la mezzanotte (per esempio dalle 22:00 alle 08:00) vale per tutta la notte.</p>
        </div>
      </section>

      <section className={ui.section} aria-labelledby={`${ids}-preview`}>
        <SectionHeader label="Cosa ti avviserei adesso" />
        <div className={styles.block} id={`${ids}-preview`}>
          {preview === null ? (
            <p className={ui.hint} role="status">
              Leggo i dati del telefono…
            </p>
          ) : (
            <>
              {previewNote ? <p className={ui.hint}>{previewNote}</p> : null}
              <NoticesList facts={preview} label="Anteprima degli avvisi" emptyText="Adesso non c'è nulla da dire. Quando c'è, lo vedi qui e nella schermata Oggi." />
            </>
          )}
        </div>
      </section>

      <p className={ui.hint}>Le scelte restano su questo dispositivo. Nessun dato lascia il telefono per mandare avvisi.</p>
    </div>
  );
}
