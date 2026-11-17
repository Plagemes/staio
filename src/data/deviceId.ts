import { generateId } from "@/core/ledger";
import { getDb } from "./db";

const DEVICE_ID_KEY = "deviceId";

function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return generateId();
}

/** Identificativo casuale del dispositivo, creato al primo uso e poi conservato. */
export async function getDeviceId(): Promise<string> {
  const db = getDb();
  return db.transaction("rw", db.settings, async () => {
    const row = await db.settings.get(DEVICE_ID_KEY);
    if (typeof row?.value === "string" && row.value.length > 0) return row.value;
    const id = randomId();
    await db.settings.put({ key: DEVICE_ID_KEY, value: id });
    return id;
  });
}
