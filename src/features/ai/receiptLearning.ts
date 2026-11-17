// Dalla memoria alle righe da rivedere e ritorno: cosa si applica da solo, cosa si propone, cosa si ricorda a conferma.
// Logica pura: la lettura e la scrittura nell'archivio stanno in `receiptMemoryStore.ts`.
import { isRestrictedCode } from "@/core/catalog";
import { learnLine, lookupLine, type LearnInput, type LineState, type LoadedMemory, type MemoryEntry, type MemoryHit, type MemoryRow } from "@/core/ai/receiptMemory";
import type { ReviewLine } from "./receiptEvents";

function fromEntry(line: ReviewLine, entry: MemoryEntry): ReviewLine {
  if (entry.ignore) return { ...line, include: false, ignoreAlways: true };
  return {
    ...line,
    include: true,
    ignoreAlways: false,
    name: entry.name,
    quantityText: entry.quantity,
    quantityGuessed: false,
    category: entry.category,
    location: entry.location,
    ...(entry.barcode ? { barcode: entry.barcode, productLabel: entry.name } : { barcode: undefined, productLabel: undefined }),
    daysAfterOpening: entry.daysAfterOpening,
  };
}

const remembered = (hit: MemoryHit, applied: boolean): ReviewLine["remembered"] => ({ source: hit.source, applied, entry: hit.entry });

/** Una riga appena letta, con ciò che ricordo: applicato da solo se il negozio è noto e la riga stabile, altrimenti solo proposto. */
export function applyMemory(line: ReviewLine, memory: LoadedMemory): ReviewLine {
  const hit = line.memoryKey ? lookupLine(memory, line.memoryKey, line.seenQuantity) : undefined;
  if (!hit) return { ...line, remembered: undefined };
  // un codice interno vale solo per lo stesso negozio: senza negozio (memoria generale) si propone e basta
  const foreign = hit.entry.barcode !== undefined && isRestrictedCode(hit.entry.barcode) && hit.source !== "store";
  if (!hit.auto || foreign) return { ...line, remembered: remembered(hit, false) };
  return { ...fromEntry(line, hit.entry), remembered: remembered(hit, true) };
}

/** «Usa» sulla proposta: un tocco, e la riga diventa quella ricordata. */
export function adoptRemembered(line: ReviewLine): ReviewLine {
  if (!line.remembered) return line;
  return { ...fromEntry(line, line.remembered.entry), remembered: { ...line.remembered, applied: true }, touched: true };
}

/** Il negozio è cambiato: le righe che l'utente non ha toccato si rileggono dalla memoria del nuovo negozio. */
export function reapplyMemory(lines: readonly ReviewLine[], base: readonly ReviewLine[], memory: LoadedMemory): ReviewLine[] {
  const byKey = new Map(base.map((l) => [l.key, l]));
  return lines.map((l) => {
    const fresh = byKey.get(l.key);
    return l.touched || !fresh ? l : applyMemory(fresh, memory);
  });
}

/** Righe applicate da sola dalla memoria del negozio e non ancora toccate: «come l'ultima volta». */
export const rememberedCount = (lines: readonly ReviewLine[]): number => lines.filter((l) => l.remembered?.applied && !l.touched).length;

export function stateOfLine(line: ReviewLine): LineState {
  return {
    name: line.name.trim().replace(/\s+/g, " "),
    category: line.category,
    quantity: line.quantityText.trim(),
    location: line.location,
    ignore: line.ignoreAlways === true,
    ...(line.barcode ? { barcode: line.barcode } : {}),
    ...(line.daysAfterOpening !== undefined ? { daysAfterOpening: line.daysAfterOpening } : {}),
  };
}

/** Le righe confermate, o segnate «ignora sempre», da ricordare. Una riga ripetuta sullo stesso scontrino conta una volta. */
export function learnInputs(lines: readonly ReviewLine[], now: string): LearnInput[] {
  const seen = new Set<string>();
  const inputs: LearnInput[] = [];
  for (const line of lines) {
    if (!line.memoryKey || seen.has(line.memoryKey)) continue;
    if (!line.include && !line.ignoreAlways) continue;
    seen.add(line.memoryKey);
    inputs.push({ key: line.memoryKey, final: stateOfLine(line), ...(line.proposed ? { proposed: line.proposed } : {}), ...(line.seenQuantity ? { seen: line.seenQuantity } : {}), now });
  }
  return inputs;
}

/** La riga della memoria dopo aver imparato da questo scontrino. */
export function learnFromLines(row: MemoryRow, lines: readonly ReviewLine[], now: string): MemoryRow {
  return learnInputs(lines, now).reduce((r, input) => learnLine(r, input), row);
}
