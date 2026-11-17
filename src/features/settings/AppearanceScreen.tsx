"use client";

import Link from "next/link";
import { useId } from "react";
import { MODES, SectionHeader, THEMES, resolveMode } from "@/design";
import ui from "../ui.module.css";
import { chooseAppearance, useAppearance, useSystemDark } from "./appearance";
import { ThemePreview } from "./ThemePreview";
import styles from "./AppearanceScreen.module.css";

export function AppearanceScreen() {
  const ids = useId();
  const { choice } = useAppearance();
  const systemDark = useSystemDark();
  const resolved = resolveMode(choice.mode, systemDark);

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Aspetto</h1>
        <Link href="/app/impostazioni" className={ui.textLink}>
          Torna alle impostazioni
        </Link>
      </div>

      <section className={ui.section} aria-labelledby={`${ids}-theme`}>
        <SectionHeader label="Tema" />
        <fieldset className={styles.fieldset}>
          <legend className={ui.srOnly} id={`${ids}-theme`}>
            Tema
          </legend>
          <div className={styles.themes}>
            {THEMES.map((t) => (
              <label key={t.id} className={styles.theme}>
                <input
                  type="radio"
                  name={`${ids}-theme`}
                  value={t.id}
                  checked={choice.theme === t.id}
                  onChange={() => void chooseAppearance({ theme: t.id })}
                />
                <span className={styles.card}>
                  <ThemePreview theme={t.id} mode={resolved} />
                  <span className={styles.name}>{t.name}</span>
                  <span className={styles.description}>{t.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className={ui.section} aria-labelledby={`${ids}-mode`}>
        <SectionHeader label="Chiaro o scuro" />
        <fieldset className={styles.fieldset}>
          <legend className={ui.srOnly} id={`${ids}-mode`}>
            Chiaro o scuro
          </legend>
          <div className={ui.choices}>
            {MODES.map((m) => (
              <label key={m.id} className={ui.choice}>
                <input
                  type="radio"
                  name={`${ids}-mode`}
                  value={m.id}
                  checked={choice.mode === m.id}
                  onChange={() => void chooseAppearance({ mode: m.id })}
                />
                <span>{m.name}</span>
              </label>
            ))}
          </div>
          <p className={ui.hint}>La scelta vale per questo dispositivo e si applica subito.</p>
        </fieldset>
      </section>
    </div>
  );
}
