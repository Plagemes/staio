// Livello energetico di esempio della Tab. 9.1 CREA con cui si leggono le indicazioni. Scelta dell'app: 2000 kcal di
// partenza, cambiabile. È un'impostazione scritta apposta, non una Memoria.
import { DEFAULT_LEVEL, ENERGY_LEVELS, type EnergyLevel } from "@/core/diet";
import { getSetting, removeSetting, setSetting } from "@/data";

export const LEVEL_KEY = "quality.eaten.level";

export { DEFAULT_LEVEL };

export const isEnergyLevel = (v: unknown): v is EnergyLevel => (ENERGY_LEVELS as readonly unknown[]).includes(v);

/** Il livello letto dall'impostazione; un valore assente o non valido vale quello di partenza. */
export const levelOf = (raw: unknown): EnergyLevel => (isEnergyLevel(raw) ? raw : DEFAULT_LEVEL);

/** Scrive il livello; «Annulla» rimette il valore di prima (anche l'assenza). */
export async function saveDietLevel(level: EnergyLevel): Promise<{ undo(): Promise<void> }> {
  if (!isEnergyLevel(level)) throw new Error("invalid_energy_level");
  const before = await getSetting<unknown>(LEVEL_KEY);
  await setSetting(LEVEL_KEY, level);
  return {
    undo: () => (isEnergyLevel(before) ? setSetting(LEVEL_KEY, before) : removeSetting(LEVEL_KEY)),
  };
}
