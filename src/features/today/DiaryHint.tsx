"use client";

import { useState } from "react";
import { useSetting } from "@/data";
import { Hint } from "../common/Hint";
import { hintKey, isHintSeen } from "../common/hints";

/**
 * «Tocca una riga del diario …», una volta sola e mai nella stessa visita di quello di «Adesso» (uno per schermata):
 * si mostra solo se «Adesso» non ha niente da dire per questa visita, cioè se il suo suggerimento era già stato visto
 * quando la schermata si è aperta. `Now` e il diario nascono insieme, quindi la prima lettura è quella di prima.
 */
export function DiaryHint() {
  const add = useSetting<unknown>(hintKey("add"));
  const [addSeenBefore, setAddSeenBefore] = useState<boolean | null>(null);
  if (addSeenBefore === null && !add.loading) setAddSeenBefore(add.error !== undefined || isHintSeen(add.data));
  if (addSeenBefore !== true) return null;
  return <Hint id="diaryRow" />;
}
