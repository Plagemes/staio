import type { ElementType, ReactNode } from "react";
import { cx } from "../cx";
import styles from "./Label.module.css";

type LabelProps = {
  as?: ElementType;
  className?: string;
  children: ReactNode;
};

export function Label({ as: Tag = "span", className, children }: LabelProps) {
  return <Tag className={cx(styles.label, className)}>{children}</Tag>;
}
