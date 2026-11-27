import { describe, expect, it, vi } from "vitest";
import { analyze, dateOf, day, moodOn, noise, rng, weighIn } from "@/core/analysis/test-helpers";
import { computeAssociations } from "./compute";
import { handleAssociationsRequest, type AssociationsRequest, type AssociationsResponse } from "./associationsJob";
import { runAssociations, type WorkerLike } from "./associationsClient";

function inputs() {
  const random = rng(5);
  const events: unknown[] = [];
  for (let i = 0; i < 60; i++) {
    events.push(...day(i, { kcal: 2000 + (i % 4) * 100 }));
    events.push(weighIn(i, 80 + noise(random, 0.2)));
    events.push(moodOn(i, 3 + (i % 3)));
  }
  const { diary, intakeDays } = analyze(events);
  return { diary, intakeDays, today: dateOf(59) };
}

/** Worker finto: tiene i messaggi e lascia al test decidere quando e come rispondere. */
class FakeWorker implements WorkerLike {
  onmessage: WorkerLike["onmessage"] = null;
  onerror: WorkerLike["onerror"] = null;
  sent: AssociationsRequest[] = [];
  terminated = false;
  postMessage(m: AssociationsRequest) {
    this.sent.push(structuredClone(m)); // come un vero worker: i dati devono essere serializzabili
  }
  terminate() {
    this.terminated = true;
  }
  reply(r: AssociationsResponse) {
    this.onmessage?.({ data: structuredClone(r) });
  }
}

describe("runAssociations", () => {
  it("con il worker dà lo stesso risultato del calcolo sincrono", async () => {
    const data = inputs();
    const w = new FakeWorker();
    const run = runAssociations(data, () => w);
    const response = handleAssociationsRequest(w.sent[0]);
    expect(response).toBeDefined();
    w.reply(response!);
    expect(await run.promise).toEqual(computeAssociations(data.diary, data.intakeDays, data.today));
    expect(w.terminated).toBe(true);
  });

  it("senza Worker ripiega sul thread principale con lo stesso risultato", async () => {
    const data = inputs();
    const run = runAssociations(data, () => undefined);
    expect(await run.promise).toEqual(computeAssociations(data.diary, data.intakeDays, data.today));
  });

  it("se il Worker non si crea ripiega senza errori", async () => {
    const data = inputs();
    const run = runAssociations(data, () => {
      throw new Error("non supportato");
    });
    expect(await run.promise).toEqual(computeAssociations(data.diary, data.intakeDays, data.today));
  });

  it("se il worker fallisce a caricarsi ripiega sul thread principale", async () => {
    const data = inputs();
    const w = new FakeWorker();
    const run = runAssociations(data, () => w);
    w.onerror?.(new Event("error"));
    expect(w.terminated).toBe(true);
    expect(await run.promise).toEqual(computeAssociations(data.diary, data.intakeDays, data.today));
  });

  it("un errore riportato dal worker rifiuta la promessa", async () => {
    const w = new FakeWorker();
    const run = runAssociations(inputs(), () => w);
    w.reply({ id: w.sent[0].id, ok: false, message: "boom" });
    await expect(run.promise).rejects.toThrow("boom");
    expect(w.terminated).toBe(true);
  });

  it("annullando termina il worker e non risolve", async () => {
    const w = new FakeWorker();
    const run = runAssociations(inputs(), () => w);
    const settle = vi.fn();
    run.promise.then(settle, settle);
    run.cancel();
    expect(w.terminated).toBe(true);
    await Promise.resolve();
    expect(settle).not.toHaveBeenCalled();
  });

  it("annullando il ripiego il calcolo non parte", async () => {
    vi.useFakeTimers();
    try {
      const run = runAssociations(inputs(), () => undefined);
      const settle = vi.fn();
      run.promise.then(settle, settle);
      run.cancel();
      await vi.runAllTimersAsync();
      expect(settle).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("scarta una risposta con id diverso e accetta quella giusta", async () => {
    const data = inputs();
    const w = new FakeWorker();
    const run = runAssociations(data, () => w);
    const real = handleAssociationsRequest(w.sent[0])!;
    w.reply({ id: w.sent[0].id - 1, ok: false, message: "vecchia" });
    w.reply(real);
    expect(await run.promise).toEqual(computeAssociations(data.diary, data.intakeDays, data.today));
  });

  it("la risposta tardiva di un'esecuzione annullata non tocca la nuova", async () => {
    const a = new FakeWorker();
    const b = new FakeWorker();
    const first = runAssociations(inputs(), () => a);
    first.cancel();
    const second = runAssociations(inputs(), () => b);
    expect(a.sent[0].id).not.toBe(b.sent[0].id);
    a.reply(handleAssociationsRequest(a.sent[0])!);
    b.reply(handleAssociationsRequest(b.sent[0])!);
    await expect(second.promise).resolves.toMatchObject({ status: expect.any(String) });
  });
});

describe("handleAssociationsRequest con la quota di prodotti molto lavorati", () => {
  it("passa processedShareByDate al calcolo, serializzabile", () => {
    const data = { ...inputs(), processedShareByDate: { [dateOf(1)]: { share: 0.5, coverage: 0.9 } } };
    const r = handleAssociationsRequest(structuredClone({ type: "run" as const, id: 1, ...data }));
    expect(r).toEqual({ id: 1, ok: true, result: computeAssociations(data.diary, data.intakeDays, data.today, data.processedShareByDate) });
  });
});

describe("handleAssociationsRequest", () => {
  it("ignora l'annullo e trasforma le eccezioni in risposta d'errore", () => {
    expect(handleAssociationsRequest({ type: "cancel", id: 1 })).toBeUndefined();
    const bad = handleAssociationsRequest({ type: "run", id: 2, diary: undefined as never, intakeDays: [], today: "2026-01-01" });
    expect(bad).toMatchObject({ id: 2, ok: false });
  });
});
