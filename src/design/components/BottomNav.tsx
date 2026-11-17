import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "../cx";
import styles from "./BottomNav.module.css";

export type NavArea = "today" | "pantry" | "plan" | "health";

type BottomNavProps = {
  current?: NavArea | "capture";
  hrefs?: Partial<Record<NavArea | "capture", string>>;
  className?: string;
};

const svgProps = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

type Area = { id: NavArea; label: string; defaultHref: string; icon: ReactNode };

const AREAS: Area[] = [
  {
    id: "today",
    label: "Oggi",
    defaultHref: "/",
    icon: (
      <svg {...svgProps}>
        <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />
      </svg>
    ),
  },
  {
    id: "pantry",
    label: "Dispensa",
    defaultHref: "/dispensa",
    icon: (
      <svg {...svgProps}>
        <rect x="4" y="3" width="16" height="18" rx="1.5" />
        <path d="M4 9.5h16" />
        <path d="M4 15.5h16" />
      </svg>
    ),
  },
  {
    id: "plan",
    label: "Piano",
    defaultHref: "/piano",
    icon: (
      <svg {...svgProps}>
        <rect x="4" y="5" width="16" height="15" rx="1.5" />
        <path d="M4 10h16" />
        <path d="M8 3v4" />
        <path d="M16 3v4" />
      </svg>
    ),
  },
  {
    id: "health",
    label: "Salute",
    defaultHref: "/salute",
    icon: (
      <svg {...svgProps}>
        <path d="M3 12h4l3-7 4 14 3-7h4" />
      </svg>
    ),
  },
];

export function BottomNav({ current, hrefs = {}, className }: BottomNavProps) {
  const [today, pantry, plan, health] = AREAS;
  const item = (area: Area) => (
    <Link
      key={area.id}
      href={hrefs[area.id] ?? area.defaultHref}
      className={cx(styles.item, current === area.id && styles.current)}
      aria-current={current === area.id ? "page" : undefined}
    >
      {area.icon}
      {area.label}
    </Link>
  );
  return (
    <nav aria-label="Aree" className={cx(styles.nav, className)}>
      {item(today)}
      {item(pantry)}
      <Link
        href={hrefs.capture ?? "/cattura"}
        className={cx(styles.capture, current === "capture" && styles.captureCurrent)}
        aria-label="Cattura"
        aria-current={current === "capture" ? "page" : undefined}
      >
        <svg {...svgProps} width={24} height={24}>
          <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
      </Link>
      {item(plan)}
      {item(health)}
    </nav>
  );
}
