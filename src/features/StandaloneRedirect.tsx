"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Se la pagina è aperta come app installata, porta subito all'app. Non rende niente. */
export function StandaloneRedirect() {
  const router = useRouter();
  useEffect(() => {
    const legacy = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (legacy || window.matchMedia("(display-mode: standalone)").matches) router.replace("/app");
  }, [router]);
  return null;
}
