// Frasi della schermata di sincronizzazione: logica pura, provata nei test.
import { EVENT_FAMILIES, type EventFamily } from "@/core/events";
import type {
  ClockWarning,
  PackageError,
  QuarantineReason,
  ScopeItemId,
  SyncCryptoErrorCode,
  SyncErrorCode,
  SyncReport,
} from "@/core/sync";
import { formatDayLabel, formatTime } from "../format";

export interface Message {
  ok: boolean;
  text: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("{n}", String(n)));

export function when(instant: string): string {
  return `${formatDayLabel(instant)} alle ${formatTime(instant)}`;
}

export function syncErrorText(code: SyncErrorCode | undefined): string {
  switch (code) {
    case "offline":
      return "Nessuna connessione. Riprova quando sei in rete: non si è perso niente.";
    case "unauthorized":
      return "Google non ha confermato l'accesso. Tocca di nuovo «Sincronizza ora» per ricollegarti.";
    case "forbidden":
      return "Google ha negato l'accesso alla cartella dell'app su Drive.";
    case "rate_limited":
      return "Google chiede di rallentare. Riprova tra qualche minuto.";
    case "server":
      return "Google Drive non risponde bene in questo momento. Riprova più tardi.";
    case "too_many_files":
      return "Nella cartella dell'app su Drive ci sono troppi file da leggere in una volta. Niente è stato cambiato.";
    case "key_unreadable":
      return "Caricamento sospeso: un file di chiave non si legge su Drive. I dati ricevuti sono stati applicati; quelli di questo dispositivo restano qui e partono quando il file torna leggibile.";
    case "key_mismatch":
      return "Su Drive i dati sono cifrati con una frase diversa da quella di questo dispositivo. Non ho caricato niente: inserisci qui sotto la frase che usi sugli altri dispositivi.";
    case "no_key":
      return "Prima inserisci la frase segreta: su Drive i dati vanno solo cifrati.";
    default:
      return "La sincronizzazione si è interrotta. Riprova: ciò che è già stato scambiato resta, e niente va perso.";
  }
}

/** Esito di una sincronizzazione, in poche frasi. */
export function describeReport(report: SyncReport): Message {
  if (report.status !== "ok") return { ok: false, text: syncErrorText(report.error) };
  const parts: string[] = [];
  const added = report.received.added;
  const sent = report.sent.events;
  if (added > 0) parts.push(plural(added, "1 evento nuovo ricevuto", "{n} eventi nuovi ricevuti"));
  if (sent > 0) parts.push(plural(sent, "1 evento inviato", "{n} eventi inviati"));
  if (report.received.conflicts > 0) {
    parts.push(
      plural(
        report.received.conflicts,
        "1 evento era diverso tra i dispositivi: tenuta la stessa versione ovunque",
        "{n} eventi erano diversi tra i dispositivi: tenuta la stessa versione ovunque",
      ),
    );
  }
  if (report.released > 0) {
    parts.push(plural(report.released, "1 dato messo da parte ora è stato applicato", "{n} dati messi da parte ora sono stati applicati"));
  }
  if (report.quarantined > 0) {
    parts.push(plural(report.quarantined, "1 dato messo da parte perché non leggibile", "{n} dati messi da parte perché non leggibili"));
  }
  if (report.locked > 0) {
    parts.push(
      plural(
        report.locked,
        "1 blocco di dati è cifrato con una frase che questo dispositivo non ha ancora: inserisci la frase segreta e sincronizza di nuovo",
        "{n} blocchi di dati sono cifrati con una frase che questo dispositivo non ha ancora: inserisci la frase segreta e sincronizza di nuovo",
      ),
    );
  }
  if (report.skipped.length > 0) {
    parts.push(
      plural(
        report.skipped.length,
        "1 file non si è potuto scaricare: resta su Drive e si riprova alla prossima sincronizzazione",
        "{n} file non si sono potuti scaricare: restano su Drive e si riprova alla prossima sincronizzazione",
      ),
    );
  }
  if (report.overflow > 0) {
    parts.push(
      plural(
        report.overflow,
        "1 dato messo da parte non è stato conservato perché erano già troppi. Gli eventi validi sono stati applicati comunque",
        "{n} dati messi da parte non sono stati conservati perché erano già troppi. Gli eventi validi sono stati applicati comunque",
      ),
    );
  }
  if (report.recovered) {
    parts.push("La numerazione dei dati inviati da questo dispositivo era rovinata ed è stata riparata: i dati sono stati inviati di nuovo");
  }
  if (report.missing.length > 0) {
    parts.push(
      plural(
        report.missing.length,
        "1 blocco annunciato da un altro dispositivo non si trova: forse non è ancora arrivato",
        "{n} blocchi annunciati da un altro dispositivo non si trovano: forse non sono ancora arrivati",
      ),
    );
  }
  if (parts.length === 0) return { ok: true, text: "Tutto allineato: niente di nuovo da scambiare." };
  return { ok: true, text: `${parts.join(". ")}.` };
}

export function lastOutcome(report: SyncReport | undefined): string {
  if (!report) return "Mai eseguita su questo dispositivo.";
  const at = when(report.finishedAt);
  if (report.status === "ok") return `Riuscita ${at}.`;
  return `Non riuscita ${at}.`;
}

export function quarantineReasonText(reason: QuarantineReason): string {
  switch (reason) {
    case "future_event":
    case "future_version":
      return "Viene probabilmente da una versione più recente dell'app. Aggiorna l'app su questo dispositivo e sincronizza di nuovo.";
    case "invalid_event":
      return "Il dato non rispetta le regole del registro, quindi non è stato applicato.";
    case "hash_mismatch":
    case "count_mismatch":
      return "Il blocco è arrivato alterato o incompleto.";
    case "unencrypted":
      return "Il blocco non è cifrato, ma su Drive si accettano solo dati cifrati: non è stato applicato.";
    case "too_large":
      return "Il blocco è troppo grande e non è stato scaricato.";
    case "auth_failed":
      return "Il blocco cifrato non supera la verifica: è stato alterato o è danneggiato.";
    default:
      return "Il blocco non si legge: è danneggiato o non è in un formato noto.";
  }
}

/** "circa 2 ore", "circa 15 minuti", "circa 3 giorni". */
export function formatSkew(ms: number): string {
  const abs = Math.abs(ms);
  const minutes = Math.round(abs / 60_000);
  if (minutes < 90) return plural(minutes, "circa 1 minuto", "circa {n} minuti");
  const hours = Math.round(abs / 3_600_000);
  if (hours < 36) return plural(hours, "circa 1 ora", "circa {n} ore");
  return plural(Math.round(abs / 86_400_000), "circa 1 giorno", "circa {n} giorni");
}

export function clockWarningText(w: ClockWarning, ownDeviceId: string | undefined): string {
  const who = w.deviceId === ownDeviceId ? "di questo dispositivo" : `del dispositivo ${shortDevice(w.deviceId)}`;
  const dir = w.skewMs > 0 ? "avanti" : "indietro";
  if (w.kind === "future_records") {
    return `Alcuni eventi ${who} risultano registrati ${formatSkew(w.skewMs)} nel futuro. Probabilmente il suo orologio è ${dir}: controlla data e ora nelle impostazioni del telefono. I dati non vengono corretti.`;
  }
  return `L'orologio ${who} sembra ${dir} di ${formatSkew(w.skewMs)}. Controlla data e ora nelle impostazioni del telefono: le date degli eventi registrati lì potrebbero essere sbagliate. I dati non vengono corretti.`;
}

export function shortDevice(deviceId: string | undefined): string {
  return deviceId ? deviceId.slice(0, 8) : "sconosciuto";
}

// `Record<EventFamily, …>`: una famiglia nuova senza nome qui non compila, e un test lo ricorda.
const FAMILY_LABELS = {
  pantry: "dispensa",
  diary: "diario",
  plan: "piani",
  prep: "preparazioni",
  recipes: "ricette",
  experiments: "esperimenti",
  allergenConfirmations: "allergeni e conferme",
} satisfies Record<EventFamily, string>;

export function familyLabel(family: EventFamily | string): string {
  return (FAMILY_LABELS as Record<string, string>)[family] ?? "altri dati del registro";
}

/** Le famiglie di eventi in parole, prese da `EVENT_FAMILIES`. */
export function familiesText(): string {
  const labels = [...new Set(EVENT_FAMILIES.map((f) => familyLabel(f.family)))];
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
}

export function scopeText(id: ScopeItemId): { label: string; detail: string } {
  switch (id) {
    case "events":
      return {
        label: "Tutto ciò che registri",
        detail: `Gli eventi del registro: ${familiesText()}. Si aggiungono soltanto: la sincronizzazione non cancella mai niente.`,
      };
    case "ai":
      return { label: "Chiave e impostazioni dell'intelligenza artificiale", detail: "Restano su ogni dispositivo. Vanno inserite su ciascuno." };
    case "token":
      return { label: "Accesso a Google", detail: "Il permesso di usare Drive vale solo finché l'app è aperta e non viene salvato." };
    case "passphrase":
      return { label: "Frase segreta", detail: "Non viene salvata né inviata. Sul dispositivo resta solo una chiave che non si può leggere." };
    case "appearance":
      return { label: "Aspetto", detail: "Tema e scelta tra chiaro e scuro valgono per il singolo dispositivo." };
    case "device":
      return { label: "Identità del dispositivo", detail: "Ogni dispositivo ha la sua." };
    case "otherSettings":
      return {
        label: "Altre impostazioni",
        detail: "Profilo, obiettivi e scelte ricordate restano sul dispositivo. Puoi copiarle con «Copia delle impostazioni».",
      };
    case "photos":
      return { label: "Foto", detail: "Per ora le foto di scontrini e piatti non vengono sincronizzate." };
  }
}

export function passphraseErrorText(code: SyncCryptoErrorCode | string | undefined): string {
  switch (code) {
    case "passphrase_too_short":
      return "La frase è troppo corta: usa almeno 12 caratteri, meglio quattro o cinque parole.";
    case "wrong_passphrase":
      return "La frase non è quella giusta. Nessun dato è stato toccato e nessuna chiave è stata creata.";
    case "passphrase_mismatch":
      return "Le due frasi non coincidono. Scrivile di nuovo.";
    case "key_exists":
      return "Una frase segreta esiste già: inserisci quella, non una nuova.";
    case "no_existing_key":
      return "Nessuna frase segreta è ancora stata impostata: creane una.";
    case "weak_key_info":
    case "invalid_key_info":
      return "I parametri della chiave trovati non sono validi. Nessun dato è stato toccato.";
    case "webcrypto_unavailable":
      return "Questo browser non offre la cifratura necessaria.";
    default:
      return "Non sono riuscito a usare la frase. Riprova.";
  }
}

export function clearQuarantineQuestion(count: number): string {
  return `${plural(count, "Togliere 1 dato messo da parte?", "Togliere {n} dati messi da parte?")} Non si potranno più applicare né vedere. Il registro non cambia.`;
}

/** Avviso sui file del pacchetto che questa versione non riconosce; `null` se non ce ne sono. */
export function packageReadText(ignored: number): string | null {
  if (ignored <= 0) return null;
  return plural(
    ignored,
    "1 file del pacchetto non è stato riconosciuto ed è stato lasciato da parte. Forse viene da una versione più recente dell'app.",
    "{n} file del pacchetto non sono stati riconosciuti e sono stati lasciati da parte. Forse vengono da una versione più recente dell'app.",
  );
}

export function packageErrorText(error: PackageError): string {
  switch (error) {
    case "invalid_json":
      return "Il file non si legge: non è un pacchetto valido.";
    case "unsupported_version":
      return "Il pacchetto viene da una versione più recente dell'app. Aggiorna l'app e riprova.";
    case "invalid_files":
      return "Il pacchetto è danneggiato.";
    default:
      return "Questo file non è un pacchetto di sincronizzazione. Per le copie di sicurezza usa «Importa una copia» nelle impostazioni.";
  }
}
