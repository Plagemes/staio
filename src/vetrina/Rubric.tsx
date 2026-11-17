import { Label } from "@/design";
import layout from "./layout.module.css";

/** Titoletto di una parte interna a una sezione (livello h3). */
export function Rubric({ children }: { children: string }) {
  return (
    <h3 className={layout.rubric}>
      <Label>{children}</Label>
    </h3>
  );
}
