// Le tre letture con l'intelligenza artificiale: richiesta, chiamata (con impostazioni, tetto di spesa e conteggio di
// `callAi`), interpretazione. Nessuna scrive nel registro: restituiscono bozze da rivedere.
import { buildExpiryDateRequest } from "@/core/ai/expiryDatePrompt";
import { parseExpiryDates, type ExpiryReading } from "@/core/ai/expiryDateParse";
import { buildLabelNutritionRequest } from "@/core/ai/labelNutritionPrompt";
import { parseLabelNutrition, type LabelReading } from "@/core/ai/labelNutritionParse";
import { buildMealPhraseRequest, type RecentMeal } from "@/core/ai/mealPhrase";
import { parseMealPhrase, type MealPhraseDraft } from "@/core/ai/mealPhraseParse";
import { buildPlatePhotoRequest } from "@/core/ai/platePhoto";
import { parsePlatePhoto, type PlatePhotoDraft } from "@/core/ai/platePhotoParse";
import { buildRecipeIdeasRequest } from "@/core/ai/recipeIdeas";
import { checkIdeas, type CheckedIdea, type IdeaCriteria, type Rejection } from "@/core/ai/recipeIdeasCheck";
import { parseRecipeIdeas } from "@/core/ai/recipeIdeasParse";
import type { DraftProblem } from "@/core/ai/mealPhraseShared";
import type { AiImage, AiUsage } from "@/core/ai";
import { callAi, type CallArgs, type CallResult } from "../ai/call";
import type { ProviderId } from "../ai/providers/types";
import type { PantryTarget } from "./pantryRefs";

type Base = Omit<CallArgs, "request">;

/** Ciò che serve sapere di una chiamata, per mostrarlo all'utente. */
export interface CallInfo {
  usage: AiUsage;
  usageEstimated: boolean;
  provider: ProviderId;
  model: string;
  cost: number | null;
  currency: string;
  truncated: boolean;
}

const infoOf = (r: CallResult): CallInfo => ({
  usage: r.usage,
  usageEstimated: r.usageEstimated,
  provider: r.provider,
  model: r.model,
  cost: r.cost,
  currency: r.currency,
  truncated: r.response.truncated,
});

export interface ReadPhraseArgs extends Base {
  phrase: string;
  target: PantryTarget;
  recent: readonly RecentMeal[];
  /** Data di oggi `YYYY-MM-DD`. */
  today: string;
}

/** Lancia un `AiError` se la chiamata fallisce; un testo illeggibile non è un errore: arriva come problemi nella bozza. */
export async function readMealPhrase(args: ReadPhraseArgs): Promise<{ draft: MealPhraseDraft; info: CallInfo }> {
  const { phrase, target, recent, today, ...rest } = args;
  const result = await callAi({ ...rest, request: buildMealPhraseRequest({ phrase, pantry: target.refs, recent, today }) });
  return { draft: parseMealPhrase(result.response.text, target.refs, { truncated: result.response.truncated }), info: infoOf(result) };
}

export interface ReadPlateArgs extends Base {
  image: AiImage;
  target: PantryTarget;
}

export async function readPlatePhoto(args: ReadPlateArgs): Promise<{ draft: PlatePhotoDraft; info: CallInfo }> {
  const { image, target, ...rest } = args;
  const result = await callAi({ ...rest, request: buildPlatePhotoRequest({ image, pantry: target.refs }) });
  return { draft: parsePlatePhoto(result.response.text, target.refs, { truncated: result.response.truncated }), info: infoOf(result) };
}

export interface ReadIdeasArgs extends Base {
  target: PantryTarget;
  criteria: IdeaCriteria;
  equipment: readonly string[];
  servings: number;
  today: string;
}

export interface IdeasOutcome {
  accepted: CheckedIdea[];
  rejected: Rejection[];
  /** Problemi di lettura della risposta (non delle ricette). */
  problems: DraftProblem[];
  info: CallInfo;
}

/** Chiede le idee e, a risposta arrivata, ricontrolla allergeni, esclusioni e dispensa: non si affida al modello. */
export async function readRecipeIdeas(args: ReadIdeasArgs): Promise<IdeasOutcome> {
  const { target, criteria, equipment, servings, today, ...rest } = args;
  const request = buildRecipeIdeasRequest({
    pantry: target.refs,
    allergens: criteria.allergens,
    excludedFoods: criteria.excludedFoods,
    ...(criteria.maxMinutes !== undefined ? { maxMinutes: criteria.maxMinutes } : {}),
    equipment,
    servings,
    today,
  });
  const result = await callAi({ ...rest, request });
  const reading = parseRecipeIdeas(result.response.text, target.refs, { truncated: result.response.truncated, servings });
  const { accepted, rejected } = checkIdeas(reading.ideas, criteria, target.refs);
  return { accepted, rejected, problems: reading.problems, info: infoOf(result) };
}

export interface ReadExpiryArgs extends Base {
  image: AiImage;
  /** Data di oggi `YYYY-MM-DD`. */
  today: string;
}

/** Legge la data stampata. Non scrive nulla: restituisce opzioni da far scegliere e confermare. */
export async function readExpiryDate(args: ReadExpiryArgs): Promise<{ reading: ExpiryReading; info: CallInfo }> {
  const { image, today, ...rest } = args;
  const result = await callAi({ ...rest, request: buildExpiryDateRequest({ image }) });
  return { reading: parseExpiryDates(result.response.text, { today, truncated: result.response.truncated }), info: infoOf(result) };
}

export interface ReadLabelArgs extends Base {
  image: AiImage;
}

/** Legge la tabella nutrizionale. Non scrive nulla: restituisce una bozza da rivedere campo per campo. */
export async function readNutritionLabel(args: ReadLabelArgs): Promise<{ reading: LabelReading; info: CallInfo }> {
  const { image, ...rest } = args;
  const result = await callAi({ ...rest, request: buildLabelNutritionRequest({ image }) });
  return { reading: parseLabelNutrition(result.response.text, { truncated: result.response.truncated }), info: infoOf(result) };
}
