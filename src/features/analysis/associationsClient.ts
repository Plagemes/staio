// Esegue il calcolo delle associazioni in un Web Worker, con ripiego sul thread principale.
// Solo nel browser: il Worker si crea quando si chiama `runAssociations`, mai all'import.
import type { AssociationsResult } from "@/core/analysis";
import {
  handleAssociationsRequest,
  type AssociationsInputs,
  type AssociationsRequest,
  type AssociationsResponse,
} from "./associationsJob";

/** La parte di Worker che serve: permette di sostituirlo con uno finto nei test. */
export interface WorkerLike {
  postMessage(message: AssociationsRequest): void;
  terminate(): void;
  onmessage: ((event: { data: AssociationsResponse }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type WorkerFactory = () => WorkerLike | undefined;

export interface AssociationsRun {
  promise: Promise<AssociationsResult>;
  /** Annulla: il worker si termina e la promessa non si risolve più. */
  cancel: () => void;
}

/** Il Worker reale. L'URL deve stare dentro `new Worker(...)` perché il bundler lo riconosca. */
export function createBrowserWorker(): WorkerLike | undefined {
  if (typeof Worker === "undefined") return undefined;
  return new Worker(new URL("./associations.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
}

let nextId = 1;

export function runAssociations(inputs: AssociationsInputs, createWorker: WorkerFactory = createBrowserWorker): AssociationsRun {
  const id = nextId++;
  let settled = false;
  let worker: WorkerLike | undefined;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  let resolve!: (r: AssociationsResult) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<AssociationsResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const release = () => {
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      try {
        worker.terminate();
      } catch {
        // già chiuso
      }
      worker = undefined;
    }
    if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
  };
  const finish = (response: AssociationsResponse) => {
    if (settled || response.id !== id) return; // risposta vecchia o doppia: scartata
    settled = true;
    release();
    if (response.ok) resolve(response.result);
    else reject(new Error(response.message));
  };
  const runInline = () => {
    // Dopo un respiro, perché la pagina possa disegnare lo stato "calcolo in corso".
    fallbackTimer = setTimeout(() => {
      if (settled) return;
      const response = handleAssociationsRequest({ type: "run", id, ...inputs });
      if (response) finish(response);
    }, 0);
  };

  try {
    worker = createWorker();
  } catch {
    worker = undefined;
  }
  if (!worker) {
    runInline();
  } else {
    const w = worker;
    w.onmessage = (event) => finish(event.data);
    // Un errore di caricamento o di esecuzione del worker non deve rompere la pagina: si ripiega.
    w.onerror = () => {
      if (settled) return;
      release();
      runInline();
    };
    try {
      w.postMessage({ type: "run", id, ...inputs });
    } catch {
      release();
      runInline();
    }
  }

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      release();
    },
  };
}
