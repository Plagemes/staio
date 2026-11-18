// L'identificativo dell'operazione: lo stesso su tutti gli eventi scritti insieme da una sola azione.
// È un campo in più sulla busta, facoltativo: i validatori di ogni famiglia ignorano i campi che non conoscono, quindi
// un evento che lo porta resta valido anche per una versione dell'app che non sa che cosa sia, e viaggia intatto con la
// sincronizzazione e con la copia di sicurezza. Gli eventi scritti prima non lo hanno: per loro vale l'istante.
// Chi scrive un evento nuovo gli dà sempre l'identificativo della sua scrittura (`stampOperationId`), anche se l'evento
// è nato copiando i campi di uno già scritto e ne porta uno: quello è dell'azione di prima. Per un periodo non è stato
// così, e nei registri restano eventi con l'identificativo ereditato: non si riscrivono, li riconosce chi legge
// (`features/activity/operations.ts`).

export const OPERATION_ID_FIELD = "opId";
export const OPERATION_ID_MAX_LENGTH = 64;

/** L'identificativo dell'operazione di un evento; `undefined` se non c'è o non è utilizzabile. */
export function operationIdOf(e: unknown): string | undefined {
  try {
    if (typeof e !== "object" || e === null) return undefined;
    const value = (e as Record<string, unknown>)[OPERATION_ID_FIELD];
    return typeof value === "string" && value !== "" && value.length <= OPERATION_ID_MAX_LENGTH ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Gli stessi eventi con l'identificativo dell'operazione. Un evento che ne ha già uno lo tiene: serve a chi non deve
 * riscrivere ciò che un'altra scrittura ha deciso. Per una scrittura nuova si usa `stampOperationId`.
 */
export function withOperationId<T extends object>(events: readonly T[], opId: string): T[] {
  return events.map((e) => (operationIdOf(e) !== undefined ? e : { ...e, [OPERATION_ID_FIELD]: opId }));
}

/**
 * Gli stessi eventi, tutti con questo identificativo dell'operazione: quello che un evento portava già (anche non
 * utilizzabile) viene sostituito. È ciò che fa una scrittura nuova: i suoi eventi sono tutti suoi. Gli eventi passati
 * non vengono toccati.
 */
export function stampOperationId<T extends object>(events: readonly T[], opId: string): T[] {
  return events.map((e) => ({ ...e, [OPERATION_ID_FIELD]: opId }));
}
