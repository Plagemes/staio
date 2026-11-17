import type { Metadata } from "next";
import { Soon } from "@/features/shell/Soon";

export const metadata: Metadata = { title: "Piano" };

export default function PianoPage() {
  return (
    <Soon
      title="Piano"
      items={[
        "I pasti della settimana, scelti partendo da ciò che hai in casa.",
        "Proposte che usano per primo ciò che sta per scadere.",
        "La lista della spesa, con solo ciò che manca davvero.",
      ]}
      note="Per ora Staio registra ciò che entra, si mangia e si butta. Il piano arriverà dopo."
    />
  );
}
