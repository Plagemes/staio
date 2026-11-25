"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

/** La chiave di un modulo «nuova voce»: dipende dall'arrivo sulla pagina, dai parametri e dai salvataggi fatti. Pura. */
export function formEpochKey(bfcacheId: string, params: string, saves: number): string {
  return JSON.stringify([bfcacheId, params, saves]);
}

/**
 * `epoch` va messa come `key` sul componente che tiene lo stato del modulo.
 * Cambia: a ogni arrivo da un collegamento o da `router.push`/`replace` (`bfcacheId` del router);
 * quando cambiano i parametri dell'indirizzo passati in `params`; dopo `renew()`.
 * Resta uguale tornando con il tasto indietro: il modulo lasciato a metà si ritrova.
 */
export function useFormEpoch(params = ""): { epoch: string; renew: () => void } {
  const { bfcacheId } = useRouter();
  const [saves, setSaves] = useState(0);
  const renew = useCallback(() => setSaves((n) => n + 1), []);
  return { epoch: formEpochKey(bfcacheId, params, saves), renew };
}
