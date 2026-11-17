"use client";

// Disegna una vista già calcolata con i componenti del design. Non sa nulla di intelligenza artificiale:
// riceve i dati dei blocchi e li mostra, con la base di dati sotto ogni numero.
import { useMemo, useState } from "react";
import { formatNumber, formatWithUnit, runView, type BlockData, type NumberResult, type QueryResult, type RowsResult, type SeriesResult, type ViewContext, type ViewData, type ViewSpec } from "@/core/views";
import { Button, Figure, Label, ProgressLine, Value } from "@/design";
import { CERTAINTY_LABELS } from "../nutrition/labels";
import { addManualEntries } from "../shopping";
import styles from "./assistant.module.css";

interface GeneratedViewProps {
  data: ViewData;
  /** Titolo da mostrare al posto di quello della vista (il nome scelto dall'utente per una vista fissata). */
  title?: string;
  headingLevel?: 2 | 3;
}

export function GeneratedView({ data, title, headingLevel = 2 }: GeneratedViewProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className={styles.view} aria-label={title ?? data.title}>
      <Heading className={styles.viewTitle}>{title ?? data.title}</Heading>
      {data.blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </article>
  );
}

interface RunViewProps {
  spec: ViewSpec;
  ctx: ViewContext;
  title?: string;
  headingLevel?: 2 | 3;
}

/** Calcola la vista sui dati correnti e la disegna: niente intelligenza artificiale, solo la descrizione e i dati. */
export function RunView({ spec, ctx, title, headingLevel }: RunViewProps) {
  const data = useMemo(() => runView(spec, ctx), [spec, ctx]);
  return <GeneratedView data={data} title={title} headingLevel={headingLevel} />;
}

function Block({ block }: { block: BlockData }) {
  switch (block.type) {
    case "text":
      return (
        <div className={styles.block}>
          <Label>Nota dell&apos;assistente, non verificata</Label>
          <p className={styles.text}>{block.text}</p>
        </div>
      );
    case "action":
      return (
        <div className={styles.actionRow}>
          {block.action === "add_to_shopping" && block.item !== undefined ? (
            <AddToShopping item={block.item} label={block.label} />
          ) : block.href ? (
            <Button href={block.href} variant="outline">
              {block.label}
            </Button>
          ) : null}
        </div>
      );
    case "figure":
      return (
        <div className={styles.block}>
          <FigureResult label={block.caption || block.label} result={block.result} />
          {block.caption && block.label ? <p className={styles.aiLabel}>{block.label}</p> : null}
        </div>
      );
    case "list":
      return (
        <div className={styles.block}>
          <Label>{block.caption || block.label || "Elenco"}</Label>
          {block.caption && block.label ? <p className={styles.aiLabel}>{block.label}</p> : null}
          <ResultBody result={block.result} />
        </div>
      );
    case "chart":
      return (
        <div className={styles.block}>
          <Label>{block.caption || block.label || "Andamento"}</Label>
          {block.caption && block.label ? <p className={styles.aiLabel}>{block.label}</p> : null}
          <ResultBody result={block.result} label={block.caption || block.label} />
        </div>
      );
  }
}

const basisLine = (basis: string, certainty: NumberResult["certainty"]): string =>
  [basis, certainty ? CERTAINTY_LABELS[certainty] : ""].filter(Boolean).join(" · ");

function Insufficient({ result }: { result: Extract<QueryResult, { kind: "insufficient" }> }) {
  return (
    <>
      <p className={styles.insufficient}>
        <span className={styles.insufficientTag}>Dati insufficienti</span>
        <br />
        {result.reason}
      </p>
      {result.basis ? <p className={styles.basis}>{result.basis}</p> : null}
    </>
  );
}

function FigureResult({ label, result }: { label: string; result: QueryResult }) {
  if (result.kind === "insufficient") {
    return (
      <>
        <Figure label={label}>
          <Value certainty="untracked" />
        </Figure>
        <Insufficient result={result} />
      </>
    );
  }
  if (result.kind !== "number") return null;
  const euros = result.unit === "€";
  const text = euros ? formatWithUnit(result.value, "€") : formatNumber(result.value, result.digits);
  return (
    <>
      <Figure label={label} suffix={euros ? undefined : result.unit}>
        <Value certainty={result.certainty === "estimated" ? "estimated" : "measured"}>{text}</Value>
      </Figure>
      <p className={styles.basis}>{basisLine(result.basis, result.certainty)}</p>
      {result.note ? <p className={styles.note}>{result.note}</p> : null}
    </>
  );
}

function ResultBody({ result, label }: { result: QueryResult; label?: string }) {
  if (result.kind === "insufficient") return <Insufficient result={result} />;
  if (result.kind === "rows") return <Rows result={result} />;
  if (result.kind === "series") return <Chart result={result} label={label} />;
  return null;
}

function Rows({ result }: { result: RowsResult }) {
  return (
    <>
      {result.rows.length > 0 ? (
        <ul className={styles.rows}>
          {result.rows.map((row, i) => (
            <li key={i} className={styles.row}>
              <span className={styles.rowName}>{row.label}</span>
              <span className={styles.rowValue}>{row.certainty === "estimated" ? <Value certainty="estimated">{row.valueText}</Value> : row.valueText}</span>
              {row.share !== undefined ? (
                <div className={styles.rowBar}>
                  <ProgressLine value={Math.round(row.share * 100)} max={100} label={`${row.label}: ${Math.round(row.share * 100)} per cento`} />
                </div>
              ) : null}
              {row.detail ? <span className={styles.rowDetail}>{row.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.insufficient}>Nessuna voce.</p>
      )}
      <p className={styles.basis}>{result.basis}</p>
      {result.note ? <p className={styles.note}>{result.note}</p> : null}
    </>
  );
}

const W = 300;
const H = 90;
const PAD = 6;

function Chart({ result, label }: { result: SeriesResult; label?: string }) {
  const { points } = result;
  const known = points.flatMap((p, i) => (p.value === null ? [] : [{ i, label: p.label, value: p.value }]));
  if (known.length < 2) return <Insufficient result={{ kind: "insufficient", reason: "Servono almeno due punti con un dato per disegnare un andamento.", basis: result.basis }} />;
  const values = known.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const last = points.length - 1;
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / last;
  const y = (v: number) => (max === min ? H / 2 : H - PAD - ((v - min) / (max - min)) * (H - 2 * PAD));
  // un punto senza dato interrompe la linea: nessuno zero inventato
  let path = "";
  let pen = false;
  points.forEach((p, i) => {
    if (p.value === null) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)} `;
    pen = true;
  });
  const fmt = (v: number) => (result.unit === "€" ? formatWithUnit(v, "€") : `${formatNumber(v, result.digits)} ${result.unit}`);
  const first = known[0];
  const end = known[known.length - 1];
  const summary = `${label ?? "Andamento"}: da ${first.label} ${fmt(first.value)} a ${end.label} ${fmt(end.value)}; minimo ${fmt(min)}, massimo ${fmt(max)}.`;
  return (
    <>
      <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} preserveAspectRatio="none">
        <line className={styles.chartAxis} x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} />
        <path className={styles.chartLine} d={path.trim()} />
        {points.length <= 31 ? known.map((p) => <circle key={p.i} className={styles.chartDot} cx={x(p.i)} cy={y(p.value)} r={2} />) : null}
      </svg>
      <div className={styles.chartLabels} aria-hidden="true">
        <span>{points[0].label}</span>
        <span>
          {fmt(min)} – {fmt(max)}
        </span>
        <span>{points[last].label}</span>
      </div>
      <p className={styles.basis}>{basisLine(result.basis, result.certainty)}</p>
      {result.note ? <p className={styles.note}>{result.note}</p> : null}
    </>
  );
}

function AddToShopping({ item, label }: { item: string; label: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  async function onClick() {
    if (state === "busy") return;
    setState("busy");
    try {
      await addManualEntries([{ product: item }]);
      setState("done");
    } catch {
      setState("error");
    }
  }
  return (
    <>
      <Button variant="outline" onClick={onClick} disabled={state === "busy"}>
        {label}: {item}
      </Button>
      <span role="status" className={styles.status}>
        {state === "done" ? "Aggiunto alla lista della spesa." : state === "error" ? "Non sono riuscito ad aggiungerlo." : ""}
      </span>
    </>
  );
}
