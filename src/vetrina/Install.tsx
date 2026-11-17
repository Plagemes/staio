"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { APP_NAME } from "@/config";
import { Button, Label } from "@/design";
import {
  SERVER_INSTALL_STATE,
  getInstallState,
  getPlatform,
  getStandalone,
  promptInstall,
  subscribeInstall,
  subscribeNothing,
  subscribeStandalone,
  type Platform,
} from "./install-store";
import styles from "./Install.module.css";

/** Dove porta "Apri" quando l'app è già installata e aperta. */
const APP_HOME = "/app";

function ShareIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 15V3.5M8 7l4-4 4 4M6 10.5H5.5A1.5 1.5 0 0 0 4 12v7a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-7a1.5 1.5 0 0 0-1.5-1.5H18" />
    </svg>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return (
    <ol className={styles.steps} role="list">
      {children}
    </ol>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className={styles.step}>
      <span className={styles.stepNo}>{String(n).padStart(2, "0")}</span>
      <span>{children}</span>
    </li>
  );
}

function Status({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.status}>
      <Label as="p">{label}</Label>
      <p className={styles.lead}>{children}</p>
    </div>
  );
}

/** Istruzioni per tutti i dispositivi: è anche ciò che si vede prima che la pagina riconosca il telefono. */
function AllDevices() {
  return (
    <dl className={styles.devices}>
      <div className={styles.device}>
        <dt>
          <Label>iPhone e iPad</Label>
        </dt>
        <dd>In Safari tocca Condividi, poi «Aggiungi alla schermata Home».</dd>
      </div>
      <div className={styles.device}>
        <dt>
          <Label>Android</Label>
        </dt>
        <dd>In Chrome tocca «Installa» se compare, oppure apri il menu e scegli «Installa app».</dd>
      </div>
      <div className={styles.device}>
        <dt>
          <Label>Computer</Label>
        </dt>
        <dd>
          In Chrome o Edge usa l&apos;icona di installazione nella barra degli indirizzi. In Safari su Mac scegli File,
          «Aggiungi al Dock».
        </dd>
      </div>
    </dl>
  );
}

export function Install() {
  const standalone = useSyncExternalStore(subscribeStandalone, getStandalone, () => false);
  const platform = useSyncExternalStore<Platform>(subscribeNothing, getPlatform, () => "unknown");
  const install = useSyncExternalStore(subscribeInstall, getInstallState, () => SERVER_INSTALL_STATE);
  const [outcome, setOutcome] = useState<"idle" | "accepted" | "dismissed">("idle");

  const onInstall = async () => {
    const result = await promptInstall();
    setOutcome(result === "accepted" ? "accepted" : "dismissed");
  };

  let view: ReactNode;

  if (standalone) {
    view = (
      <>
        <Status label="Installata">Stai usando l&apos;app installata.</Status>
        <div className={styles.actions}>
          <Button href={APP_HOME}>Apri</Button>
        </div>
      </>
    );
  } else if (install.installed || outcome === "accepted") {
    view = (
      <Status label="Installata">
        {APP_NAME} è installata. La trovi nella schermata Home o nell&apos;elenco delle app.
      </Status>
    );
  } else if (install.prompt) {
    view = (
      <>
        <Status label="Disponibile">
          Questo dispositivo può installare l&apos;app con un tocco. Si apre a schermo intero, senza la barra del
          browser.
        </Status>
        <div className={styles.actions}>
          <Button onClick={onInstall}>Installa</Button>
        </div>
      </>
    );
  } else if (platform === "ios") {
    view = (
      <>
        <Status label="iPhone e iPad">
          Su iPhone e iPad l&apos;app si aggiunge alla schermata Home. Servono quattro passaggi.
        </Status>
        <Steps>
          <Step n={1}>Apri questa pagina in Safari.</Step>
          <Step n={2}>
            Tocca Condividi <ShareIcon />, il quadrato con la freccia verso l&apos;alto.
          </Step>
          <Step n={3}>Scorri l&apos;elenco e tocca «Aggiungi alla schermata Home».</Step>
          <Step n={4}>Tocca «Aggiungi». L&apos;icona compare tra le tue app.</Step>
        </Steps>
      </>
    );
  } else if (platform === "android") {
    view = (
      <>
        <Status label="Android">
          Il browser non propone l&apos;installazione con un tocco. Si fa dal menu.
        </Status>
        <Steps>
          <Step n={1}>Apri questa pagina in Chrome.</Step>
          <Step n={2}>Tocca i tre puntini in alto a destra.</Step>
          <Step n={3}>Scegli «Installa app», o «Aggiungi a schermata Home» se manca.</Step>
        </Steps>
      </>
    );
  } else if (platform === "desktop") {
    view = (
      <>
        <Status label="Computer">
          Il browser non propone l&apos;installazione da questa pagina. Ecco come fare con i principali.
        </Status>
        <AllDevices />
        <p className={styles.note}>Firefox per computer non installa le app web: usa Chrome, Edge o Safari.</p>
      </>
    );
  } else {
    view = (
      <>
        <Status label="Come si installa">
          L&apos;app si installa dal browser, senza negozi di app. Il gesto dipende dal dispositivo.
        </Status>
        <AllDevices />
      </>
    );
  }

  return (
    <div className={styles.panel}>
      {outcome === "dismissed" && !install.prompt ? (
        <p className={styles.note} role="status">
          Installazione annullata. Se cambi idea, usa il menu del browser.
        </p>
      ) : null}
      {view}
    </div>
  );
}
