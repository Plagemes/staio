"use client";

import { Week } from "./Week";

/**
 * «/app/piano/verifica»: la stessa schermata della Settimana, con la verifica aperta e in vista. Nessun reindirizzamento:
 * senza rete il vecchio indirizzo si apre lo stesso, dalla copia salvata.
 */
export function Verify() {
  return <Week openVerify />;
}
