import { APP_TAGLINE } from "@/config";
import { Button, Label, Wordmark } from "@/design";
import layout from "./layout.module.css";
import { Plate } from "./Plate";
import { STAIO_RECIPE } from "./staio-recipe";
import styles from "./Hero.module.css";

export function Hero() {
  return (
    <div className={styles.hero}>
      <div className={layout.wrap}>
        <div className={styles.bar}>
          <Label>App installabile</Label>
          <Label>In costruzione</Label>
        </div>

        <div className={styles.grid}>
          <div className={styles.head}>
            <h1 className={styles.title}>
              <Wordmark size="lg" />
            </h1>
            <p className={styles.tagline}>{APP_TAGLINE}</p>
          </div>

          <div className={styles.plate}>
            <Plate recipe={STAIO_RECIPE} size="large">
              <span>Tav. I · Staio, misura del grano</span>
              <span>Lo staio era il recipiente con cui si misurava il grano. Qui misura il cibo.</span>
            </Plate>
          </div>

          <div className={styles.body}>
            <p className={styles.lede}>Il registro di tutto il cibo che entra in casa, viene mangiato o buttato.</p>
            <p className={`${layout.prose} ${styles.text}`}>
              Scrivi cosa compri, cosa mangi e cosa butti. Il resto si calcola da sé: dispensa, scadenze, nutrienti,
              spesa. È un&apos;app da installare sul telefono, pensata per funzionare anche senza rete.
            </p>
            <div className={styles.actions}>
              <Button href="#installa">Installa l&apos;app</Button>
              <Button href="#come-funziona" variant="outline">
                Come funziona
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
