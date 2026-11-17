/**
 * Un «corredo» di resa per stile: materiali e oggetti three di uno stile solo, dietro la stessa interfaccia.
 * Gli motori (modello singolo, scena del frigo) tengono un corredo e lo sostituiscono quando il tema cambia stile:
 * `dispose()` del corredo e `disposeMaterials()` degli oggetti liberano i materiali del vecchio stile, mentre le
 * geometrie, che sono dati del modello e non dello stile, si riusano.
 */
import type { Material, Mesh } from "three";
import { applyColorTheme, createColorModelObject, createColorShared, createContactShadow, createInkLineMaterial } from "./color-style";
import type { Model } from "./generate";
import { applyColors, createGroundShadow, createLineMaterial, createSharedUniforms } from "./materials";
import type { RenderStyle, ThemeSnapshot } from "./theme";
import { createModelObject, type ModelObject } from "./three-model";

export interface KitObjectOptions {
  /** Scade presto: a incisione tutto nel colore segnale; a colori contorno e punto esclamativo. */
  signal?: boolean;
  /** Secondo tratteggio incrociato (solo incisione). */
  cross?: boolean;
  /** Tratteggio più leggero per le superfici piatte (solo incisione). */
  soft?: number;
  /** Mobile (a colori: tinte attenuate nel tema scuro). */
  furniture?: boolean;
}

export interface StyleKit {
  readonly style: RenderStyle;
  /** Aggiorna in place ciò che dipende dal tema dentro lo stesso stile (colori, chiaro/scuro). */
  setTheme(theme: ThemeSnapshot): void;
  createObject(model: Model, opts?: KitObjectOptions): ModelObject;
  /** Ombra a terra: piano quadrato di lato `size` centrato nell'origine, a y = 0. */
  createGroundShadow(size: number): Mesh;
  /** Materiale per le linee di servizio (anello di selezione). */
  createLineMaterial(): Material;
  /** Libera ciò che il corredo possiede oltre agli oggetti creati (che si liberano da soli). */
  dispose(): void;
}

function engravingKit(theme: ThemeSnapshot): StyleKit {
  const shared = createSharedUniforms(theme.colors);
  return {
    style: "engraving",
    setTheme(next) {
      applyColors(shared, next.colors);
    },
    createObject(model, opts = {}) {
      return createModelObject(model, shared, { signal: opts.signal, cross: opts.cross, soft: opts.soft });
    },
    createGroundShadow: (size) => createGroundShadow(shared, size),
    createLineMaterial: () => createLineMaterial(shared, false),
    dispose() {},
  };
}

function colorKit(theme: ThemeSnapshot): StyleKit {
  const shared = createColorShared(theme);
  return {
    style: "color",
    setTheme(next) {
      applyColorTheme(shared, next);
    },
    createObject(model, opts = {}) {
      return createColorModelObject(model, shared, { signal: opts.signal, furniture: opts.furniture });
    },
    createGroundShadow: (size) => createContactShadow(shared, size),
    createLineMaterial: () => createInkLineMaterial(shared),
    dispose() {},
  };
}

export function createStyleKit(theme: ThemeSnapshot): StyleKit {
  return theme.style === "color" ? colorKit(theme) : engravingKit(theme);
}
