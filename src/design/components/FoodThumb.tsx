import type { ReactNode } from "react";
import { cx } from "../cx";
import styles from "./FoodThumb.module.css";

/** Il «segnaposto illustrato» di un alimento o di un piatto: l'app non ha foto, quindi un disegno semplice per categoria. */
export type FoodThumbKind =
  | "dairy"
  | "cheese"
  | "vegetable"
  | "fruit"
  | "meat"
  | "fish"
  | "egg"
  | "bread"
  | "bowl"
  | "drink"
  | "jar"
  | "sweet"
  | "frozen"
  | "dish";

type FoodThumbProps = {
  kind: FoodThumbKind;
  /** «hero» è la testa di una ricetta o di una scheda, «sm» è la miniatura di una riga. */
  size?: "sm" | "hero";
  className?: string;
};

/* Disegni su una griglia 48 × 48: contorno nel colore dell'accento, riempimento tenue sulle forme chiuse. */
const SHAPES: Record<FoodThumbKind, ReactNode> = {
  dairy: (
    <>
      <path d="M17 14h14l3 6v19H14V20z" fill="currentColor" fillOpacity=".16" />
      <path d="M14 20h20" />
      <path d="M20 29h8" />
    </>
  ),
  cheese: (
    <>
      <path d="M8 31l32-9v14H8z" fill="currentColor" fillOpacity=".16" />
      <path d="M8 31l32-9" />
      <circle cx="20" cy="34" r="1.6" />
      <circle cx="30" cy="31" r="1.6" />
    </>
  ),
  vegetable: (
    <>
      <path d="M11 37C11 21 22 10 38 10c0 15-10 27-27 27z" fill="currentColor" fillOpacity=".16" />
      <path d="M11 37L29 19" />
    </>
  ),
  fruit: (
    <>
      <path d="M24 17c-8-4-16 2-14 12 1 8 7 13 14 10 7 3 13-2 14-10 2-10-6-16-14-12z" fill="currentColor" fillOpacity=".16" />
      <path d="M24 17c0-4 2-6 5-7" />
    </>
  ),
  meat: (
    <>
      <path d="M9 27c0-8 8-13 16-13s13 4 13 10-6 12-16 12-13-4-13-9z" fill="currentColor" fillOpacity=".16" />
      <circle cx="26" cy="25" r="3.5" />
    </>
  ),
  fish: (
    <>
      <path d="M7 24c6-8 17-10 25-4l9-6v20l-9-6c-8 6-19 4-25-4z" fill="currentColor" fillOpacity=".16" />
      <circle cx="16" cy="23" r="1.2" />
    </>
  ),
  egg: <path d="M24 9c7 0 11 10 11 18a11 11 0 0 1-22 0c0-8 4-18 11-18z" fill="currentColor" fillOpacity=".16" />,
  bread: (
    <>
      <path d="M10 29c-3-8 4-15 14-15s17 7 14 15v8H10z" fill="currentColor" fillOpacity=".16" />
      <path d="M18 22l3 5" />
      <path d="M25 21l3 6" />
    </>
  ),
  bowl: (
    <>
      <path d="M9 24h30a15 13 0 0 1-30 0z" fill="currentColor" fillOpacity=".16" />
      <path d="M18 17c0-2 2-2 2-4" />
      <path d="M26 17c0-2 2-2 2-4" />
    </>
  ),
  drink: (
    <>
      <path d="M15 11h18l-2 27H17z" fill="currentColor" fillOpacity=".16" />
      <path d="M16 21h16" />
    </>
  ),
  jar: (
    <>
      <path d="M17 12h14v5l3 4v17H14V21l3-4z" fill="currentColor" fillOpacity=".16" />
      <path d="M14 27h20" />
    </>
  ),
  sweet: (
    <>
      <circle cx="24" cy="24" r="14" fill="currentColor" fillOpacity=".16" />
      <circle cx="19" cy="20" r="1.4" />
      <circle cx="29" cy="22" r="1.4" />
      <circle cx="23" cy="30" r="1.4" />
    </>
  ),
  frozen: (
    <>
      <path d="M24 9v30" />
      <path d="M11 16.5l26 15" />
      <path d="M11 31.5l26-15" />
    </>
  ),
  dish: (
    <>
      <path d="M11 35a13 14 0 0 1 26 0z" fill="currentColor" fillOpacity=".16" />
      <path d="M7 35h34" />
      <circle cx="24" cy="15" r="1.8" />
    </>
  ),
};

/**
 * Disegno decorativo, sempre aria-hidden. Si vede solo in Grano (themes.css, regole `data-variant="grano"` nel suo modulo);
 * negli altri temi l'attributo `hidden` lo tiene fuori dalla pagina e dall'impaginazione.
 */
export function FoodThumb({ kind, size = "sm", className }: FoodThumbProps) {
  return (
    <span className={cx(styles.thumb, size === "hero" && styles.hero, className)} aria-hidden="true" hidden>
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {SHAPES[kind]}
      </svg>
    </span>
  );
}
