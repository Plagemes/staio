"use client";

import { useEffect } from "react";

/**
 * Regole di stampa per ciò che sta fuori dal Rapporto (la barra in basso, gli avvisi, i margini della pagina).
 * Un modulo CSS non può nominare quegli elementi, perciò le regole vivono qui e valgono finché il Rapporto è aperto.
 * Le parti interne del Rapporto (comandi, titoli, schede) sono in `analysis.module.css`.
 */
export const PRINT_CSS = `
@page { size: A4; margin: 14mm; }
@media print {
  html, body { background: #fff !important; color: #000 !important; }
  [data-app-content] ~ * { display: none !important; }
  [role="status"] { display: none !important; }
  [data-area] { display: block !important; max-width: none !important; min-height: 0 !important; }
  [data-app-content] { padding: 0 !important; }
}
`;

/**
 * Stampa sempre in tema chiaro: un tema scuro su carta è illeggibile. Il tema è l'attributo `data-theme` della radice;
 * lo si porta a «chiaro» prima della stampa e lo si rimette com'era dopo.
 */
export function PrintSupport() {
  useEffect(() => {
    const root = document.documentElement;
    let saved: { value: string | null } | null = null;
    const before = () => {
      if (saved) return;
      saved = { value: root.getAttribute("data-theme") };
      root.setAttribute("data-theme", "light");
    };
    const after = () => {
      if (!saved) return;
      if (saved.value === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", saved.value);
      saved = null;
    };
    const media = typeof window.matchMedia === "function" ? window.matchMedia("print") : null;
    const onMedia = (e: MediaQueryListEvent) => (e.matches ? before() : after());
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    media?.addEventListener("change", onMedia);
    return () => {
      after();
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      media?.removeEventListener("change", onMedia);
    };
  }, []);
  return <style>{PRINT_CSS}</style>;
}
