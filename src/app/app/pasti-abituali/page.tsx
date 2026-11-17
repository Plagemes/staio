import type { Metadata } from "next";
import { Habits } from "@/features/habits/Habits";

export const metadata: Metadata = { title: "Pasti abituali" };

export default function PastiAbitualiPage() {
  return <Habits />;
}
