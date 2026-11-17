import type { Metadata } from "next";
import { Suspense } from "react";
import { Meal } from "@/features/meal/Meal";

export const metadata: Metadata = { title: "Registra pasto" };

export default function PastoPage() {
  // legge `lotto` dall indirizzo: l alimento scelto dalla scheda in dispensa
  return (
    <Suspense>
      <Meal />
    </Suspense>
  );
}
