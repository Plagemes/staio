"use client";

import { useId, useState, type FormEvent } from "react";
import { ALLERGEN_CHECK_NOTICE, foldVoice } from "@/core/allergens";
import { DEFAULT_TIME_ZONE } from "@/core/diary";
import { Button, SectionHeader } from "@/design";
import { INCOMPLETE_DECLARATIONS_HERE, useDeclarationActions, type DeclarationList, type DeclaredState } from "../allergens";
import { useFormEpoch } from "../common/freshForm";
import { ALLERGEN_NAMES } from "../recipes/list";
import ui from "../ui.module.css";

const CHANGED_ON = new Intl.DateTimeFormat("it-IT", { timeZone: DEFAULT_TIME_ZONE, day: "numeric", month: "short" });

/** «Cambiato il 12 nov»; niente se l'istante non si legge. */
function changedOn(at: string | undefined): string | undefined {
  if (at === undefined) return undefined;
  const t = Date.parse(at);
  return Number.isNaN(t) ? undefined : `Cambiato il ${CHANGED_ON.format(new Date(t)).replace(/\./g, "")}`;
}

/**
 * Allergeni ed esclusioni: ogni tocco salva subito, con l'avviso e «Annulla». Nessun pulsante pieno: non c'è niente
 * da confermare alla fine.
 */
export function DeclarationsSection({ state }: { state: DeclaredState }) {
  const actions = useDeclarationActions();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<DeclarationList, string>>>({});
  const changed = changedOn(state.changedAt);

  const declared = new Map(state.allergens.map((v) => [foldVoice(v.text), v.text]));
  const known = new Set(ALLERGEN_NAMES.map(foldVoice));
  const extras = state.allergens.filter((v) => !known.has(foldVoice(v.text))).map((v) => v.text);

  async function run(list: DeclarationList, write: () => Promise<string | null>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setErrors((e) => ({ ...e, [list]: undefined }));
    try {
      const message = await write();
      if (message !== null) setErrors((e) => ({ ...e, [list]: message || undefined }));
      return message === null;
    } finally {
      setBusy(false);
    }
  }

  const toggle = (name: string) => {
    const current = declared.get(foldVoice(name));
    void run("allergens", () => (current !== undefined ? actions.remove("allergens", current) : actions.add("allergens", name)));
  };

  return (
    <section className={ui.section}>
      <SectionHeader label="Allergeni ed esclusioni" />
      {changed ? <p className={ui.hint}>{changed}</p> : null}
      {!state.complete ? (
        <p className={ui.error} role="alert">
          {INCOMPLETE_DECLARATIONS_HERE}
        </p>
      ) : null}

      <fieldset className={ui.field}>
        <legend className={ui.fieldLabel}>Allergeni</legend>
        <div className={ui.choices}>
          {[...ALLERGEN_NAMES, ...extras].map((name) => (
            <label key={foldVoice(name)} className={ui.choice}>
              <input type="checkbox" checked={declared.has(foldVoice(name))} onChange={() => toggle(name)} disabled={busy} />
              <span>{name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <AddVoice
        label="Un altro allergene"
        disabled={busy}
        error={errors.allergens}
        onAdd={(text) => run("allergens", () => actions.add("allergens", text))}
      />

      <div className={ui.field}>
        <p className={ui.fieldLabel}>Alimenti esclusi</p>
        {state.excludedFoods.length === 0 ? (
          <p className={ui.paragraph}>Nessuno.</p>
        ) : (
          <div className={ui.form}>
            {state.excludedFoods.map((v) => (
              <div key={foldVoice(v.text)} className={ui.row}>
                <span className={ui.paragraph}>{v.text}</span>
                <Button
                  variant="text"
                  disabled={busy}
                  aria-label={`Togli ${v.text}`}
                  onClick={() => void run("excludedFoods", () => actions.remove("excludedFoods", v.text))}
                >
                  Togli
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
      <AddVoice
        label="Escludi un alimento"
        disabled={busy}
        error={errors.excludedFoods}
        onAdd={(text) => run("excludedFoods", () => actions.add("excludedFoods", text))}
      />

      <p className={ui.hint}>{ALLERGEN_CHECK_NOTICE}</p>
    </section>
  );
}

interface AddVoiceProps {
  label: string;
  disabled: boolean;
  error: string | undefined;
  /** `true` se la voce è stata salvata: il campo si svuota. */
  onAdd: (text: string) => Promise<boolean>;
}

function AddVoice(props: AddVoiceProps) {
  const { epoch, renew } = useFormEpoch();
  return <AddVoiceForm key={epoch} {...props} onSaved={renew} />;
}

function AddVoiceForm({ label, disabled, error, onAdd, onSaved }: AddVoiceProps & { onSaved: () => void }) {
  const id = useId();
  const [text, setText] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (text.trim() === "") return;
    if (await onAdd(text)) onSaved();
  }

  return (
    <form className={ui.field} onSubmit={(e) => void onSubmit(e)}>
      <label className={ui.fieldLabel} htmlFor={`${id}-text`}>
        {label}
      </label>
      <div className={ui.row}>
        <input
          id={`${id}-text`}
          className={ui.input}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <Button type="submit" variant="outline" disabled={disabled || text.trim() === ""}>
          Aggiungi
        </Button>
      </div>
      {error ? (
        <p id={`${id}-error`} className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
