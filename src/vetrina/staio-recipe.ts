import type { Recipe } from "@/models3d/recipe";

/**
 * Lo staio: antico recipiente per misurare il grano. Recipiente di legno a doghe, un poco più largo in alto,
 * con tre cerchi di ferro sottili e un colmo basso di chicchi. È un solido di rotazione: i cerchi sono gradini
 * del profilo, il bordo un anello piano e il colmo una cresta frastagliata più stretta del bordo.
 */
const wall = (y: number) => Number((0.9 + 0.1 * (y / 2)).toFixed(3));
const HOOP = 0.06;

/** Cerchio di ferro: due punti sulla parete, due sul rilievo. */
const hoop = (y0: number, y1: number): [number, number][] => [
  [wall(y0), y0],
  [wall(y0) + HOOP, y0 + 0.012],
  [wall(y1) + HOOP, y1 - 0.012],
  [wall(y1), y1],
];

export const STAIO_RECIPE: Recipe = {
  id: "staio",
  name: "Staio",
  category: "dispensa",
  archetype: "lathe",
  heightCm: 28,
  variation: 0.25,
  hatch: { density: 1.1 },
  params: {
    smooth: false,
    segments: 64,
    profile: [
      [0, 0],
      [0.88, 0],
      [0.9, 0.04],
      ...hoop(0.18, 0.26),
      ...hoop(1.0, 1.08),
      ...hoop(1.68, 1.76),
      // parete fino al labbro
      [wall(1.93), 1.93],
      // labbro: sporge appena e chiude con un anello piano, così il bordo resta netto
      [1.07, 1.95],
      [1.07, 2.05],
      [0.84, 2.05],
      // colmo di chicchi: cresta bassa e irregolare, più stretta del bordo
      [0.8, 2.08],
      [0.73, 2.15],
      [0.68, 2.12],
      [0.6, 2.23],
      [0.52, 2.2],
      [0.45, 2.3],
      [0.36, 2.27],
      [0.27, 2.36],
      [0.17, 2.33],
      [0.08, 2.4],
      [0, 2.38],
    ],
  },
};
