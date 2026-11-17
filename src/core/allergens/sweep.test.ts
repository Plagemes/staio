// Prova a tappeto: ogni voce delle tabelle, in molte forme (plurale e singolare, accenti, maiuscole, quantità davanti,
// dentro una frase, come nome dell'alimento di dispensa collegato), non deve mai dare `clear` per il suo allergene.
import { describe, expect, it } from "vitest";
import {
  ALLERGEN_TABLES,
  COMPOSITES,
  GENERIC_TERMS,
  HYPONYM_GROUPS,
  assessItem,
  assessText,
  matchExclusion,
  type Verdict,
} from "./index";
import { STOPWORDS } from "./normalize";

type Mode = "stem" | "exact" | "prefix" | "infix";

function parse(entry: string): { text: string; mode: Mode } {
  if (entry.startsWith("=")) return { text: entry.slice(1), mode: "exact" };
  if (entry.startsWith("~")) return { text: entry.slice(1), mode: "infix" };
  if (entry.endsWith("*")) return { text: entry.slice(0, -1), mode: "prefix" };
  return { text: entry, mode: "stem" };
}

/** Plurale (o singolare) italiano regolare di una parola. */
function flip(w: string): string {
  if (w.length <= 3 || STOPWORDS.has(w)) return w;
  if (/[cg]o$/.test(w)) return `${w.slice(0, -1)}hi`;
  if (/[cg]a$/.test(w)) return `${w.slice(0, -1)}he`;
  if (/io$/.test(w)) return w.slice(0, -1);
  if (/o$/.test(w)) return `${w.slice(0, -1)}i`;
  if (/a$/.test(w)) return `${w.slice(0, -1)}e`;
  if (/e$/.test(w)) return `${w.slice(0, -1)}i`;
  if (/i$/.test(w)) return `${w.slice(0, -1)}o`;
  return w;
}

const ACCENT: Record<string, string> = { a: "à", e: "è", i: "ì", o: "ò", u: "ù" };
function accented(s: string): string {
  const i = s.search(/[aeiou][^aeiou]*$/);
  return i < 0 ? s : `${s.slice(0, i)}${ACCENT[s[i] as string]}${s.slice(i + 1)}`;
}
const capitalized = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/** Le forme di una voce: quelle che il tipo di voce promette di riconoscere. */
function forms(entry: string): string[] {
  const { text, mode } = parse(entry);
  const base = [text, text.toUpperCase(), capitalized(text), accented(text)];
  if (mode === "stem") base.push(text.split(" ").map(flip).join(" "), capitalized(accented(text.split(" ").map(flip).join(" "))));
  if (mode === "prefix") base.push(`${text}i`, `${text}e`);
  return [...new Set(base)];
}

/** Dove può stare: da sola, con una quantità, in una frase, come alimento collegato a un ingrediente generico. */
function placements(form: string): { label: string; item?: { name: string; linkedNames?: string[] }; step?: string }[] {
  return [
    { label: "nome", item: { name: form } },
    { label: "quantità", item: { name: `200 g ${form} fresco` } },
    { label: "collegato", item: { name: "Ingrediente", linkedNames: [form] } },
    { label: "passo", step: `Unite ${form} e mescolate bene.` },
    { label: "inizio", step: `${form}: tagliare a pezzetti.` },
  ];
}

function verdict(p: ReturnType<typeof placements>[number], allergen: string): Verdict {
  if (p.step !== undefined) return assessText(p.step, [allergen]).length > 0 ? "contains" : "clear";
  const f = assessItem(p.item as { name: string }, [allergen]).findings[0];
  return f ? f.verdict : "clear";
}

describe("prova a tappeto sulle tabelle degli allergeni", () => {
  for (const table of ALLERGEN_TABLES) {
    it(`${table.key}: nessuna voce dà «clear» (${table.terms.length} voci)`, () => {
      const misses: string[] = [];
      let checked = 0;
      for (const entry of table.terms) {
        for (const form of forms(entry)) {
          for (const p of placements(form)) {
            checked++;
            if (verdict(p, table.key) === "clear") misses.push(`${entry} → «${form}» (${p.label})`);
          }
        }
      }
      expect(misses).toEqual([]);
      expect(checked).toBeGreaterThan(table.terms.length * 4);
    });
  }

  it("prodotti composti: ciò che contengono di norma è `contains`, il resto mai `clear`", () => {
    const misses: string[] = [];
    for (const c of COMPOSITES) {
      for (const form of forms(c.term)) {
        for (const key of c.contains) {
          const f = assessItem({ name: form }, [key]).findings[0];
          if (f?.verdict !== "contains") misses.push(`${c.term} → «${form}» ${key}: ${f?.verdict ?? "clear"}`);
        }
        const uncertain = c.uncertain === "all" ? ALLERGEN_TABLES.map((t) => t.key) : c.uncertain;
        for (const key of uncertain) {
          if (assessItem({ name: form }, [key]).findings.length === 0) misses.push(`${c.term} → «${form}» ${key}: clear`);
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it("ingredienti generici: mai `clear` per nessun allergene, neanche se sconosciuto", () => {
    const misses: string[] = [];
    for (const entry of GENERIC_TERMS) {
      for (const form of forms(entry)) {
        for (const key of [...ALLERGEN_TABLES.map((t) => t.key), "kiwi"]) {
          if (assessItem({ name: form }, [key]).findings.length === 0) misses.push(`${entry} → «${form}» ${key}`);
        }
      }
    }
    expect(misses).toEqual([]);
  });
});

describe("prova a tappeto sugli iponimi delle esclusioni", () => {
  for (const group of HYPONYM_GROUPS) {
    it(`«${group.names[0]}»: ogni iponimo ricade nell'esclusione, con ogni nome del gruppo`, () => {
      const misses: string[] = [];
      for (const name of group.names) {
        for (const member of group.members) {
          for (const form of forms(member)) {
            for (const text of [form, `Unite ${form} e mescolate.`]) {
              if (matchExclusion(text, name) === undefined) misses.push(`${name}: ${member} → «${text}»`);
            }
          }
        }
      }
      expect(misses).toEqual([]);
    });
  }
});
