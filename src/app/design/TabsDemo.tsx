"use client";

import { useState } from "react";
import { Tabs } from "@/design";

const ITEMS = [
  { id: "all", label: "Tutto" },
  { id: "fridge", label: "Frigo" },
  { id: "freezer", label: "Freezer" },
  { id: "pantry", label: "Credenza" },
];

export function TabsDemo() {
  const [value, setValue] = useState("all");
  return <Tabs label="Luogo" items={ITEMS} value={value} onChange={setValue} />;
}
