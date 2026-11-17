import { getRecipe, listRecipes } from "@/models3d/catalog";
import type { Recipe } from "@/models3d/recipe";
import layout from "./layout.module.css";
import { Plate } from "./Plate";
import { Section } from "./Section";
import { SHOWCASE_IDS } from "./showcase";
import styles from "./Catalog.module.css";

const NUMERALS = ["II", "III", "IV", "V", "VI", "VII"];

export function Catalog() {
  const recipes = SHOWCASE_IDS.map((id) => getRecipe(id)).filter((r): r is Recipe => r !== undefined);
  const total = listRecipes().length;

  return (
    <Section id="figure" index="04" kicker="Le figure" title="Ogni alimento ha la sua figura">
      <p className={`${layout.prose} ${styles.intro}`}>
        Le figure sono disegnate a tratti, come in una stampa antica, e nascono da una ricetta di poche righe. Il
        catalogo ne conta già {total}. Trascina una tavola per girarla.
      </p>
      <div className={styles.grid}>
        {recipes.map((recipe, i) => (
          <Plate key={recipe.id} recipe={recipe} autoRotate={false}>
            <span>
              Tav. {NUMERALS[i]} · {recipe.heightCm} cm
            </span>
            <span>{recipe.name}</span>
          </Plate>
        ))}
      </div>
    </Section>
  );
}
