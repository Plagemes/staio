// Soglie e finestre delle analisi: sono le stesse passate al motore e usate nei testi "cosa manca",
// così ciò che la schermata chiede e ciò che il calcolo pretende non possono divergere.

export const EXPENDITURE_WINDOW_DAYS = 28;
export const EXPENDITURE_MIN = { completeDays: 14, weighIns: 8, spanDays: 14 } as const;

export const PROJECTION_WINDOW_DAYS = 28;
export const PROJECTION_HORIZON_DAYS = 28;
export const PROJECTION_MIN = { weighIns: 8, spanDays: 14, staleDays: 14 } as const;

export const TIMING_WINDOW_DAYS = 28;
export const TIMING_MIN_COMPLETE_DAYS = 7;
export const LATE_DINNER_FROM_MINUTES = 21 * 60;

export const ASSOCIATION_WINDOW_DAYS = 90;
export const ASSOCIATION_MIN = { completeDays: 14, daysWith: 8, daysWithout: 8 } as const;
export const ASSOCIATION_MAX_RESULTS = 5;

export const EXPERIMENT_MIN = { observations: 7, weighIns: 6, weightSpanDays: 7 } as const;
export const EXPERIMENT_DEFAULT_DAYS = 14;

export const REPORT_MIN = { weighIns: 3, completeDays: 5 } as const;

export const NOT_MEDICAL_NOTE =
  "Sono andamenti e associazioni osservati nei tuoi dati, con la loro incertezza. Non sono pareri medici e non dicono perché qualcosa accade.";
