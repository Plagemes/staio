// L'identificativo dell'operazione: lo stesso su tutti gli eventi scritti insieme da una sola azione.
// È un campo in più sulla busta, facoltativo: i validatori di ogni famiglia ignorano i campi che non conoscono, quindi
// un evento che lo porta resta valido anche per una versione dell'app che non sa che cosa sia, e viaggia intatto con la
// sincronizzazione e con la copia di sicurezza. Gli eventi scritti prima non lo hanno: per loro vale l'istante.

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
 * Gli stessi eventi con l'identificativo dell'operazione. Un evento che ne ha già uno lo tiene: non si riscrive mai
 * ciò che un'altra scrittura ha deciso.
 */
export function withOperationId<T extends object>(events: readonly T[], opId: string): T[] {
  return events.map((e) => (operationIdOf(e) !== undefined ? e : { ...e, [OPERATION_ID_FIELD]: opId }));
}
