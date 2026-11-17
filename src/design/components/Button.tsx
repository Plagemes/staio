import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "outline" | "text";

type CommonProps = {
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
};

type ButtonAsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & { href?: undefined };
type ButtonAsLink = CommonProps & { href: string };

export function Button(props: ButtonAsButton | ButtonAsLink) {
  if (props.href !== undefined) {
    const { variant = "primary", className, children, href } = props;
    return (
      <Link className={cx(styles.button, styles[variant], className)} href={href}>
        {children}
      </Link>
    );
  }
  const { variant = "primary", className, children, type = "button", ...rest } = props;
  return (
    <button className={cx(styles.button, styles[variant], className)} type={type} {...rest}>
      {children}
    </button>
  );
}
