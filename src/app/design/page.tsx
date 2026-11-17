import type { Metadata } from "next";
import {
  BottomNav,
  Button,
  ExpiryTag,
  Figure,
  FigureGrid,
  Label,
  LedgerRow,
  LevelBar,
  PantryRow,
  ProgressLine,
  PromptCard,
  SectionHeader,
  Value,
  Wordmark,
} from "@/design";
import { TabsDemo } from "./TabsDemo";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Design" };

export default function DesignPage() {
  return (
    <div className={styles.column}>
      <main className={styles.screen}>
        <div className={styles.topbar}>
          <Wordmark />
          <Label>Lun 16 nov</Label>
        </div>

        <div className={styles.block}>
          <Label>Energia di oggi</Label>
          <div className={styles.energy}>
            <span className={styles.bigNumber}>1.840</span>
            <span className={styles.energyOf}>di 2.400 kcal</span>
          </div>
          <ProgressLine value={1840} max={2400} label="Energia di oggi: 1.840 su 2.400 kcal" />
        </div>

        <FigureGrid>
          <Figure label="Proteine" suffix="/ 130 g">
            <Value>92</Value>
          </Figure>
          <Figure label="Acqua" suffix="/ 2,5 l">
            <Value>1,4</Value>
          </Figure>
          <Figure label="Ferro" suffix="/ 10 mg">
            <Value certainty="estimated">6</Value>
          </Figure>
        </FigureGrid>

        <section>
          <SectionHeader label="Da mangiare prima" actionLabel="Tutta la dispensa" actionHref="/dispensa" />
          <PantryRow name="Petto di pollo" detail="Frigo · 400 g" expiry={<ExpiryTag level="urgent">domani</ExpiryTag>} />
          <PantryRow name="Yogurt greco" detail="Frigo · 2 di 4" expiry={<ExpiryTag level="near">3 giorni</ExpiryTag>} />
          <PantryRow
            name="Spinaci freschi"
            detail={
              <>
                Frigo · <Value certainty="estimated">150 g</Value>
              </>
            }
            expiry={
              <ExpiryTag level="calm" estimated>
                4 giorni
              </ExpiryTag>
            }
          />
        </section>

        <section>
          <SectionHeader label="Registro di oggi" />
          <LedgerRow time="08:10" description="Colazione abituale" value="420 kcal" />
          <LedgerRow
            time="13:05"
            description="Pollo, riso, spinaci"
            value={<Value certainty="estimated">610 kcal</Value>}
          />
          <LedgerRow time="17:40" description="Spesa · Conad" value="38,40 €" />
        </section>

        <PromptCard
          title="Cosa cucino stasera"
          description="Tre proposte con il pollo che scade domani"
          href="/design"
        />
      </main>

      <section className={styles.catalog} aria-labelledby="catalogo">
        <h1 id="catalogo" className={styles.catalogTitle}>
          Componenti
        </h1>

        <div className={styles.item}>
          <h2 className={styles.itemName}>Label</h2>
          <Label>Etichetta maiuscola</Label>
        </div>

        <div className={styles.item}>
          <h2 className={styles.itemName}>Value e certezza</h2>
          <div className={styles.certaintyRow}>
            <Value>92 g</Value>
            <span className={styles.note}>misurato</span>
          </div>
          <div className={styles.certaintyRow}>
            <Value certainty="label">420 kcal</Value>
            <span className={styles.note}>da etichetta</span>
          </div>
          <div className={styles.certaintyRow}>
            <Value certainty="estimated">6 mg</Value>
            <span className={styles.note}>stimato</span>
          </div>
          <div className={styles.certaintyRow}>
            <Value certainty="untracked" />
            <span className={styles.note}>non tracciato</span>
          </div>
        </div>

        <div className={styles.item}>
          <h2 className={styles.itemName}>Figure e FigureGrid</h2>
          <FigureGrid>
            <Figure label="In scadenza" tone="signal">
              <Value>5</Value>
            </Figure>
            <Figure label="Valore">
              <Value certainty="estimated">96 €</Value>
            </Figure>
            <Figure label="Certezza">
              <Value>81%</Value>
            </Figure>
          </FigureGrid>
        </div>

        <div className={styles.item}>
          <h2 className={styles.itemName}>SectionHeader</h2>
          <SectionHeader label="Senza azione" />
          <SectionHeader label="Con azione" actionLabel="Vedi tutto" actionHref="/design" />
        </div>

        <div className={styles.item}>
          <h2 className={styles.itemName}>LedgerRow</h2>
          <div className={styles.list}>
            <LedgerRow time="08:10" description="Colazione abituale" value="420 kcal" />
            <LedgerRow time="13:05" description="Pollo, riso, spinaci" value={<Value certainty="estimated">610 kcal</Value>} />
          </div>
        </div>

        <div className={styles.item}>
          <h2 className={styles.itemName}>PantryRow, LevelBar</h2>
          <div className={styles.list}>
            <PantryRow
              name="Petto di pollo"
              detail="Frigo · 400 g"
              level={100}
              levelLabel="Quantità piena"
              expiry={<ExpiryTag level="urgent">domani</ExpiryTag>}
            />
            <PantryRow
              name="Latte intero"
              detail={
                <>
                  Frigo · aperto ieri · <Value certainty="estimated">0,6 l</Value>
                </>
              }
              level={60}
              expiry={<ExpiryTag level="urgent">2 giorni</ExpiryTag>}
            />
            <PantryRow
              name="Yogurt greco"
              detail="Frigo · 2 di 4"
              level={50}
              expiry={<ExpiryTag level="near">3 giorni</ExpiryTag>}
            />
            <PantryRow
              name="Riso basmati"
              detail="Credenza · 900 g"
              level={85}
              expiry={<ExpiryTag level="calm">12 giorni</ExpiryTag>}
            />
          </div>
          <LevelBar value={30} label="Livello circa 30 per cento" />
        </div>

        <div className={styles.item}>
          <h2 className={styles.itemName}>ProgressLine</h2>
          <ProgressLine value={77} max={100} label="Avanzamento 77 per cento" />
          <ProgressLine value={30} max={100} label="Avanzamento 30 per cento" />
        </div>

        <div className={styles.item}>
          <h2 className={styles.itemName}>ExpiryTag</h2>
          <div className={styles.row}>
            <ExpiryTag level="urgent">domani</ExpiryTag>
            <ExpiryTag level="near">3 giorni</ExpiryTag>
            <ExpiryTag level="calm">12 giorni</ExpiryTag>
            <ExpiryTag level="calm" estimated>
              4 giorni
            </ExpiryTag>
          </div>
        </div>

        <div className={styles.item}>
          <h2 className={styles.itemName}>Button</h2>
          <div className={styles.row}>
            <Button>Conferma</Button>
            <Button variant="outline">Correggi</Button>
            <Button variant="text">Verifica con una foto</Button>
            <Button href="/design" variant="outline">
              Come collegamento
            </Button>
          </div>
        </div>

        <div className={styles.item}>
          <h2 className={styles.itemName}>Tabs</h2>
          <TabsDemo />
        </div>

        <div className={styles.item}>
          <h2 className={styles.itemName}>PromptCard</h2>
          <PromptCard title="Cosa cucino stasera" description="Tre proposte con il pollo che scade domani" href="/design" />
          <PromptCard title="Solo titolo" href="/design" />
        </div>

        <div className={styles.item}>
          <h2 className={styles.itemName}>Wordmark</h2>
          <Wordmark size="lg" />
        </div>
      </section>

      <div className={styles.bottom}>
        <BottomNav current="today" />
      </div>
    </div>
  );
}
