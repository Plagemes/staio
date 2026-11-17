"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useRecipes } from "@/data";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { emptyForm, formFromRecipe } from "./form";
import { RecipeEditor } from "./RecipeEditor";

/** `/app/ricette/nuova`: ricetta nuova; con `?modifica=ID`, nuova versione di una ricetta che esiste. */
export function NewRecipe() {
  const editId = useSearchParams().get("modifica");
  return editId ? <Edit id={editId} /> : <Fresh />;
}

function Fresh() {
  const initial = useMemo(() => emptyForm(), []);
  return <RecipeEditor initial={initial} certainty="measured" title="Nuova ricetta" />;
}

function Edit({ id }: { id: string }) {
  const recipes = useRecipes();
  const recipe = recipes.data?.recipes.find((r) => r.recipeId === id);
  const initial = useMemo(() => (recipe ? formFromRecipe(recipe) : undefined), [recipe]);
  if (recipes.error) return <StorageError />;
  if (!recipes.data) {
    return (
      <div className={ui.screen}>
        <LoadingLine />
      </div>
    );
  }
  if (!recipe || !initial) {
    return (
      <div className={ui.screen}>
        <EmptyState
          title="Ricetta non trovata"
          text="Non trovo la ricetta da modificare: potrebbe essere stata ritirata."
          actionLabel="Torna al ricettario"
          actionHref="/app/ricette"
        />
      </div>
    );
  }
  return (
    <RecipeEditor
      key={recipe.eventId}
      initial={initial}
      recipeId={recipe.recipeId}
      {...(recipe.rating !== undefined ? { rating: recipe.rating } : {})}
      certainty={recipe.certainty}
      title="Modifica la ricetta"
      saveLabel="Salva le modifiche"
    />
  );
}
