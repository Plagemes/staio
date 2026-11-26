"use client";

import type { ReactElement } from "react";
import { useRecipes } from "@/data";
import { Button } from "@/design";
import { cookProgressText, cookResumeHref, useCookSession } from "../recipes/cookSession";
import ui from "../ui.module.css";
import styles from "./PlannedLines.module.css";

/**
 * «Stai cucinando «Pasta al forno»»: in testa ad «Adesso», se c'è una cucina lasciata a metà su questo telefono e la
 * ricetta c'è ancora. Il timer è quello del momento in cui si disegna: qui non scorre.
 */
export function CookingNow({ now }: { now: string }): ReactElement | null {
  const { session } = useCookSession();
  const recipes = useRecipes();
  if (!session) return null;
  const recipe = recipes.data?.recipes.find((r) => r.recipeId === session.recipeId);
  if (!recipe) return null;
  return (
    <div className={styles.cooking}>
      <p className={styles.cookingTitle}>Stai cucinando «{recipe.title}»</p>
      <p className={ui.hint}>{cookProgressText(session, Date.parse(now))}</p>
      <div>
        <Button variant="outline" href={cookResumeHref(session)}>
          Riprendi
        </Button>
      </div>
    </div>
  );
}
