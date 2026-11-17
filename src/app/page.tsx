import { StandaloneRedirect } from "@/features/StandaloneRedirect";
import { Catalog } from "@/vetrina/Catalog";
import { Certainty } from "@/vetrina/Certainty";
import { Data } from "@/vetrina/Data";
import { Footer } from "@/vetrina/Footer";
import { Hero } from "@/vetrina/Hero";
import { HowItWorks } from "@/vetrina/HowItWorks";
import { Install } from "@/vetrina/Install";
import { Section } from "@/vetrina/Section";
import { Status } from "@/vetrina/Status";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <StandaloneRedirect />
      <main>
        <Hero />
        <Section id="installa" index="01" kicker="Installazione" title="Installa l'app sul telefono">
          <Install />
        </Section>
        <HowItWorks />
        <Certainty />
        <Catalog />
        <Data />
        <Status />
      </main>
      <Footer />
    </div>
  );
}
