// Aiuti per i test della sincronizzazione.
import { canonicalStringify } from "../ledger";
import { purchase, q, voidOf } from "../ledger/test-helpers";
import type { AnyEvent } from "../events";
import { createKey } from "./crypto";
import type { WriteKey } from "./engine";
import { fromUtf8 } from "./bytes";

/** Iterazioni basse solo per la velocità dei test (la produzione usa `KDF_ITERATIONS`). */
export const TEST_ITERATIONS = 1000;
export const TEST_UNLOCK = { minIterations: 1 };
export const PASSPHRASE = "la mia frase molto segreta";

export async function testKey(passphrase = PASSPHRASE): Promise<WriteKey> {
  const { keyInfo, key } = await createKey(passphrase, { iterations: TEST_ITERATIONS });
  return { keyId: keyInfo.keyId, key, keyInfo };
}

let counter = 0;

/** Acquisto valido con id unico; `at` parte da un istante fisso. */
export function buy(device: string, n = counter++, product = "farina"): AnyEvent {
  const at = new Date(Date.UTC(2026, 0, 1, 8) + n * 60_000).toISOString();
  return purchase(`${device}-${n}`, at, {
    lotId: `lot-${device}-${n}`,
    productRef: product,
    quantity: q(100 + (n % 50)),
    location: "dispensa",
    deviceId: device,
  });
}

export function voidEv(device: string, target: AnyEvent, n = counter++): AnyEvent {
  const at = new Date(Date.UTC(2026, 0, 2, 8) + n * 60_000).toISOString();
  return voidOf(`${device}-v${n}`, at, target.id, { deviceId: device });
}

export function canon(events: readonly unknown[]): string {
  return canonicalStringify(events);
}

export function text(bytes: Uint8Array): string {
  return fromUtf8(bytes);
}
