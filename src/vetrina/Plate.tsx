import type { ReactNode } from "react";
import ModelViewer from "@/models3d/ModelViewer";
import type { Recipe } from "@/models3d/recipe";
import { cx } from "@/design";
import styles from "./Plate.module.css";

type PlateProps = {
  recipe: Recipe;
  /** Rotazione lenta. Le tavole piccole stanno ferme finché non si trascinano. */
  autoRotate?: boolean;
  size?: "large" | "small";
  children: ReactNode;
};

/** Tavola illustrata: modello a incisione dentro un riquadro sottile, con didascalia. */
export function Plate({ recipe, autoRotate = true, size = "small", children }: PlateProps) {
  return (
    <figure className={cx(styles.plate, size === "large" && styles.large)}>
      <div className={styles.frame}>
        <ModelViewer recipe={recipe} autoRotate={autoRotate} />
      </div>
      <figcaption className={styles.caption}>{children}</figcaption>
    </figure>
  );
}
