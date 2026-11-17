// Memoria delle scelte: categoria e luogo già scelti per un codice a barre, e la categoria scelta per i prodotti simili.
import type { Product } from "@/core/catalog";
import type { Location } from "@/core/ledger";
import { isFoodCategory } from "../lots";

export interface RememberedChoice {
  category: string;
  location: Location;
}

export interface ChoiceStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export type Remembered =
  | { kind: "barcode"; category: string; location: Location }
  | { kind: "similar"; category: string };

const CODE_KEY = (code: string) => `barcode.choice.${code}`;
const CATEGORY_KEY = (tag: string) => `barcode.category.${tag}`;
/** Le categorie di Open Food Facts vanno dalla più generica alla più precisa: bastano le ultime. */
const SPECIFIC_TAGS = 2;

const LOCATIONS: readonly string[] = ["frigo", "freezer", "dispensa"];

const specificTags = (product: Pick<Product, "categories">): string[] =>
  (product.categories ?? []).slice(-SPECIFIC_TAGS).reverse();

/** Cosa riproporre: prima la scelta fatta per questo codice, poi quella per un prodotto simile (stessa categoria precisa). */
export async function loadRemembered(
  product: Pick<Product, "barcode" | "categories">,
  store: ChoiceStore,
): Promise<Remembered | undefined> {
  const own = (await store.get(CODE_KEY(product.barcode))) as Partial<RememberedChoice> | undefined;
  if (own && isFoodCategory(own.category) && typeof own.location === "string" && LOCATIONS.includes(own.location)) {
    return { kind: "barcode", category: own.category, location: own.location as Location };
  }
  for (const tag of specificTags(product)) {
    const category = await store.get(CATEGORY_KEY(tag));
    if (isFoodCategory(category)) return { kind: "similar", category };
  }
  return undefined;
}

/** Ricorda ciò che l'utente ha scelto aggiungendo il prodotto. */
export async function rememberChoice(
  product: Pick<Product, "barcode" | "categories">,
  choice: RememberedChoice,
  store: ChoiceStore,
): Promise<void> {
  if (!isFoodCategory(choice.category)) return;
  await store.set(CODE_KEY(product.barcode), choice);
  for (const tag of specificTags(product)) await store.set(CATEGORY_KEY(tag), choice.category);
}
