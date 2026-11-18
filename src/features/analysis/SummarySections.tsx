"use client";

import type { PeriodSummary } from "@/core/analysis";
import { SectionHeader, Value } from "@/design";
import ui from "../ui.module.css";
import { formatDecimal, outOfHomeMealsText, plural, reliabilityText } from "./present";
import { noRecordsView } from "./reportView";
import { BasisLine, InsufficientBox } from "./shared";
import {
  categoryName,
  comparisonLine,
  comparisonRangeText,
  comparisonThresholdText,
  expiredUnresolvedText,
  quantitiesText,
  savedText,
  sectionBasisText,
  valueLine,
  wasteReasonLine,
} from "./summaryView";
import styles from "./analysis.module.css";

/** Cibo entrato e mangiato nel periodo, con gli alimenti più mangiati. Il buttato sta nella sua sezione. */
export function FoodFlowSection({ summary }: { summary: PeriodSummary }) {
  const { entered, eaten, topFoods, outOfHomeMeals } = summary;
  return (
    <section className={ui.section}>
      <SectionHeader label="Il cibo del periodo" />
      <div className={styles.card}>
        <div>
          <p className={styles.note}>Entrato</p>
          {entered.status === "ok" ? (
            <>
              <p className={styles.range}>
                <Value certainty={entered.certainty}>{quantitiesText(entered.quantities)}</Value> in {plural(entered.lots, "acquisto", "acquisti")}
                {entered.declaredLots > 0 ? `; ${plural(entered.declaredLots, "alimento dichiarato", "alimenti dichiarati")} già in casa, non contati` : ""}.
              </p>
              {valueLine(entered, "degli acquisti") ? <p className={styles.range}>{valueLine(entered, "degli acquisti")}</p> : null}
              <BasisLine>{sectionBasisText(entered.basis, "con acquisti")}</BasisLine>
            </>
          ) : (
            <InsufficientBox view={noRecordsView("gli acquisti")} />
          )}
        </div>
        <div>
          <p className={styles.note}>Mangiato</p>
          {eaten.status === "ok" ? (
            <>
              <p className={styles.range}>
                <Value certainty={eaten.certainty}>{quantitiesText(eaten.quantities)}</Value>, dalla dispensa e dalle voci scritte nei pasti.
              </p>
              {valueLine(eaten, "di ciò che viene dalla dispensa") ? <p className={styles.range}>{valueLine(eaten, "di ciò che viene dalla dispensa")}</p> : null}
              <BasisLine>{sectionBasisText(eaten.basis, "con cibo mangiato")}</BasisLine>
            </>
          ) : (
            <InsufficientBox view={noRecordsView("il cibo mangiato")} />
          )}
        </div>
        {topFoods.status === "ok" ? (
          <div>
            <p className={styles.note}>Alimenti mangiati più spesso</p>
            <ul className={styles.list}>
              {topFoods.items.map((f) => (
                <li key={f.name}>
                  {f.name}: {plural(f.days, "giorno", "giorni")} ({quantitiesText(f.quantities)})
                </li>
              ))}
            </ul>
            <BasisLine>
              {topFoods.distinct > topFoods.items.length ? `Primi ${topFoods.items.length} di ${topFoods.distinct} alimenti. ` : ""}
              {sectionBasisText(topFoods.basis, "con cibo mangiato")}
            </BasisLine>
          </div>
        ) : null}
        {outOfHomeMeals > 0 ? <p className={styles.note}>{outOfHomeMealsText(outOfHomeMeals)}</p> : null}
      </div>
    </section>
  );
}

export function DishesSection({ summary }: { summary: PeriodSummary }) {
  const { dishes } = summary;
  return (
    <section className={ui.section}>
      <SectionHeader label="Piatti cucinati" />
      <div className={styles.card}>
        {dishes.status === "ok" ? (
          <>
            <p className={styles.range}>
              {plural(dishes.cooked, "pasto con un nome", "pasti con un nome")}, {plural(dishes.distinct, "piatto diverso", "piatti diversi")}.
            </p>
            <ul className={styles.list}>
              {dishes.top.map((d) => (
                <li key={d.title}>
                  {d.title}: {plural(d.count, "volta", "volte")}
                </li>
              ))}
            </ul>
            {dishes.newTitles === undefined ? (
              <p className={styles.note}>Il registro non ha pasti prima di questo periodo: non si distingue una ricetta nuova da una già fatta.</p>
            ) : (
              <p className={styles.range}>
                {dishes.newTitles.length === 0
                  ? "Nessuna ricetta nuova: tutti i piatti c'erano già nel registro."
                  : `${plural(dishes.newTitles.length, "ricetta nuova", "ricette nuove")}: ${dishes.newTitles.slice(0, 8).join(", ")}${dishes.newTitles.length > 8 ? "…" : ""}.`}
              </p>
            )}
            <BasisLine>{sectionBasisText(dishes.basis, "con un piatto cucinato")}. «Nuova» vuol dire un nome che non compariva in un pasto prima del periodo.</BasisLine>
          </>
        ) : (
          <InsufficientBox view={noRecordsView("i piatti cucinati")} />
        )}
      </div>
    </section>
  );
}

export function MoodSection({ summary }: { summary: PeriodSummary }) {
  const { mood } = summary;
  if (mood.status === "insufficient" && (mood.reasons as string[]).includes("no_records")) return null;
  return (
    <section className={ui.section}>
      <SectionHeader label="Umore" />
      <div className={styles.card}>
        {mood.status === "ok" ? (
          <>
            <p className={styles.range}>
              Media {formatDecimal(mood.average, 1)} su 5 nei giorni con l&apos;umore registrato, da {formatDecimal(mood.min, 1)} a {formatDecimal(mood.max, 1)}.
            </p>
            <BasisLine>
              {sectionBasisText(mood.basis, "con l'umore")} · {reliabilityText(mood.reliability)}
            </BasisLine>
          </>
        ) : (
          <InsufficientBox
            view={{
              title: "Dati insufficienti",
              reasons: [mood.message.replace(/^Dati insufficienti: /, "").replace(/^./, (c) => c.toUpperCase())],
              missing: ["Non vuol dire zero: vuol dire che non c'è abbastanza registrato."],
            }}
          />
        )}
      </div>
    </section>
  );
}

/** Spreco: quanto, quali categorie, perché (solo i motivi che il registro distingue), cosa è stato salvato. */
export function WasteReport({ summary }: { summary: PeriodSummary }) {
  const { discards, saved, expiredUnresolved } = summary.waste;
  return (
    <section className={ui.section}>
      <SectionHeader label="Cibo buttato" />
      <div className={styles.card}>
        {discards.status === "ok" ? (
          <>
            <p className={styles.range}>
              <Value certainty={discards.certainty}>{quantitiesText(discards.quantities)}</Value> buttati, in {plural(discards.events, "registrazione", "registrazioni")}.
            </p>
            {valueLine(discards, "buttato") ? <p className={styles.range}>{valueLine(discards, "buttato")}</p> : null}
            <div>
              <p className={styles.note}>Motivo registrato</p>
              <ul className={styles.list}>
                {discards.byReason.map((r) => (
                  <li key={r.reason}>{wasteReasonLine(r.reason, r.quantities, r.events)}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className={styles.note}>Categorie</p>
              <ul className={styles.list}>
                {discards.byCategory.map((c) => (
                  <li key={c.category ?? "none"}>
                    {categoryName(c.category)}: {quantitiesText(c.quantities)} ({plural(c.events, "volta", "volte")})
                  </li>
                ))}
              </ul>
            </div>
            <BasisLine>{sectionBasisText(discards.basis, "con uno scarto registrato")}</BasisLine>
          </>
        ) : (
          <div className={styles.insufficient} role="group" aria-label="Nessuno scarto registrato">
            <p className={styles.insufficientTitle}>Nessuno scarto registrato</p>
            <p className={styles.range}>
              Nel periodo non c&apos;è nessun cibo segnato come buttato. Non vuol dire che non ne hai buttato: vuol dire che non è stato registrato.
            </p>
            <p className={styles.note}>Per segnarlo, dalla scheda di un alimento in Dispensa scegli «Elimina» e il motivo.</p>
          </div>
        )}
        {saved ? (
          <div>
            <p className={styles.note}>Salvato</p>
            <p className={styles.range}>
              <Value certainty={saved.certainty}>{savedText(saved)}</Value>
            </p>
            <BasisLine>Contano solo i lotti con una scadenza nota, congelati non oltre quel giorno.</BasisLine>
          </div>
        ) : null}
        {expiredUnresolved > 0 ? <p className={styles.range}>{expiredUnresolvedText(expiredUnresolved)}</p> : null}
      </div>
    </section>
  );
}

export function PeriodComparison({ summary }: { summary: PeriodSummary }) {
  const c = summary.comparison;
  return (
    <section className={ui.section}>
      <SectionHeader label="Rispetto al periodo precedente" />
      <div className={styles.card}>
        {c.status === "ok" ? (
          <>
            <p className={styles.range}>{comparisonRangeText(c)}</p>
            <ul className={styles.list}>
              {c.metrics.map((m) => (
                <li key={m.id}>{comparisonLine(m)}</li>
              ))}
            </ul>
            <BasisLine>
              Giorni con qualcosa di registrato: {c.recordedDays.current} qui, {c.recordedDays.previous} prima. Una misura compare solo se c&apos;è in entrambi i periodi.
              Sono differenze, non giudizi: dipendono anche da quanto hai registrato.
            </BasisLine>
          </>
        ) : (
          <InsufficientBox
            view={{
              title: "Confronto non possibile",
              reasons: [c.message.replace(/^Dati insufficienti: /, "").replace(/^./, (x) => x.toUpperCase())],
              missing: [comparisonThresholdText(c)],
            }}
          />
        )}
      </div>
    </section>
  );
}
