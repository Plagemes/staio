import type { Metadata } from "next";
import { Fridge } from "./Fridge";

export const metadata: Metadata = { title: "Frigo" };

export default function FridgePage() {
  return <Fridge />;
}
