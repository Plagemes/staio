// Fonti delle linee guida usate da `core/diet`. Ogni valore numerico di `guidelines.ts` rimanda a una di queste.
// Il dettaglio, con le letture incerte e le scelte dell'app, è in `../FONTI.md`.

import type { Source, SourceId } from "../types";

export const DIET_SOURCES: Readonly<Record<SourceId, Source>> = Object.freeze({
  "crea-lg-2018": {
    id: "crea-lg-2018",
    body: "CREA, Centro di ricerca Alimenti e Nutrizione",
    document:
      "Linee guida per una sana alimentazione, revisione 2018 (edizione novembre 2019, ISBN 9788833850375). Pagine citate: quelle stampate",
    year: "2018",
    url: "https://www.crea.gov.it/documents/59764/0/LINEE-GUIDA+DEFINITIVO+%281%29.pdf/3c13ff3d-74dc-88d7-0985-4678aec18537?t=1579191262173",
    consultedOn: "2026-11-27",
    verified: true,
  },
  "who-sugars-2015": {
    id: "who-sugars-2015",
    body: "OMS (Organizzazione mondiale della sanità)",
    document: "Guideline: Sugars intake for adults and children (ISBN 978-92-4-154902-8)",
    year: "2015",
    url: "https://iris.who.int/server/api/core/bitstreams/4be74f01-de93-4596-bbd1-02a97afb1221/content",
    consultedOn: "2026-11-27",
    verified: true,
  },
  "who-healthy-diet": {
    id: "who-healthy-diet",
    body: "OMS (Organizzazione mondiale della sanità)",
    document: "Fact sheet «Healthy diet» (pagina datata 26 gennaio 2026)",
    year: "2026",
    url: "https://www.who.int/news-room/fact-sheets/detail/healthy-diet",
    consultedOn: "2026-11-27",
    verified: true,
  },
  "who-salt": {
    id: "who-salt",
    body: "OMS (Organizzazione mondiale della sanità)",
    document: "Fact sheet «Salt reduction» (pagina datata 11 maggio 2026)",
    year: "2026",
    url: "https://www.who.int/news-room/fact-sheets/detail/salt-reduction",
    consultedOn: "2026-11-27",
    verified: true,
  },
  "efsa-drv": {
    id: "efsa-drv",
    body: "EFSA (European Food Safety Authority)",
    document:
      "DRV Finder, voce «Dietary Fibre», adulti (valore già in core/nutrition/data/reference.ts, riletto da quel modulo, non da questo)",
    year: "2010",
    url: "https://multimedia.efsa.europa.eu/drvs/index.htm",
    consultedOn: "2026-11-17",
    verified: true,
  },
  "nova-fao-2019": {
    id: "nova-fao-2019",
    body: "FAO",
    document:
      "Monteiro e altri, classificazione NOVA, rapporto FAO 2019. Non verificata direttamente: titolo e indirizzo da controllare prima di citarla",
    year: "2019",
    url: "",
    consultedOn: "2026-11-27",
    verified: false,
  },
  app: {
    id: "app",
    body: "L'app",
    document: "Scelte dichiarate dall'app, elencate in core/diet/FONTI.md: non vengono da una fonte esterna",
    year: "2026",
    url: "",
    consultedOn: "2026-11-27",
    verified: true,
  },
});
