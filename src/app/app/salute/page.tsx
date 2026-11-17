import type { Metadata } from "next";
import { Soon } from "@/features/shell/Soon";

export const metadata: Metadata = { title: "Salute" };

export default function SalutePage() {
  return (
    <Soon
      title="Salute"
      items={[
        "Energia e nutrienti di ciò che mangi, ciascuno con il suo grado di certezza.",
        "Il confronto con valori di riferimento, mai un parere medico.",
        "Che cosa è stato stimato e che cosa è stato misurato.",
      ]}
      note="Nutrienti ed energia non sono ancora calcolati, quindi qui non ne trovi. Staio non dà pareri medici."
    />
  );
}
