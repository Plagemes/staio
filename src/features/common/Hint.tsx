"use client";

import { useEffect, useState } from "react";
import { getSetting, setSetting, useSetting } from "@/data";
import { dayOf } from "../format";
import ui from "../ui.module.css";
import { HINTS, hintKey, hintVerdict, type HintId } from "./hints";

/**
 * Un suggerimento di una riga, una volta sola: si segna come visto la prima volta che si mostra, resta per quella
 * visita della schermata, e alla visita dopo non c'è più. «Chiudi» lo toglie subito.
 */
export function useHint(id: HintId): { text: string | null; close: () => void } {
  const key = hintKey(id);
  const live = useSetting<unknown>(key);
  const [latched, setLatched] = useState(false);
  const [closed, setClosed] = useState(false);
  const [expired, setExpired] = useState(false);
  const verdict = hintVerdict({
    loading: live.loading,
    failed: live.error !== undefined,
    stored: live.data,
    latched,
    closed,
    expired,
  });

  // la prima volta che si mostra: da qui in poi vale «visto»
  if (verdict === "first") setLatched(true);

  useEffect(() => {
    if (!latched) return;
    void (async () => {
      try {
        // si rilegge: un'altra scheda può averlo già segnato
        if ((await getSetting<unknown>(key)) === undefined) await setSetting<string>(key, dayOf(new Date().toISOString()));
      } catch {
        // non si riesce a ricordarlo: resta per questa visita e può tornare alla prossima
      }
    })();
    // la schermata lasciata (o nascosta, se la pagina resta viva) chiude la visita
    return () => setExpired(true);
  }, [latched, key]);

  return { text: verdict === "none" ? null : HINTS[id], close: () => setClosed(true) };
}

/** `<Hint id="add" />`: la riga del suggerimento, con «Chiudi» di seguito. Un suggerimento solo per schermata. */
export function Hint({ id }: { id: HintId }) {
  const { text, close } = useHint(id);
  if (text === null) return null;
  return (
    <p className={ui.hint} role="note">
      {text}{" "}
      <button type="button" className={ui.textLink} onClick={close}>
        Chiudi
      </button>
    </p>
  );
}
