// Insieme di prova scritto a mano, SOLO per i test (non è importato dall'app). Non deriva da FlavorGraph: tre fasce
// assegnate a mano su abbinamenti comuni della cucina italiana, per provare ordinamento, casa e allergeni con dati noti.
import type { TasteData, TasteFood } from "./types";

type Row = readonly [key: string, name: string, foodIds: readonly string[], aliases?: readonly string[]];

const ROWS: readonly Row[] = [
  ["pomodoro", "Pomodoro", ["pomodoro-crudo", "pomodoro-ciliegino-crudo", "passata-di-pomodoro", "pomodori-pelati", "pomodori-a-pezzi"]],
  ["basilico", "Basilico", ["basilico-fresco"]],
  ["aglio", "Aglio", ["aglio-crudo"]],
  ["cipolla", "Cipolla", ["cipolla-cruda", "cipolla-rossa-cruda"]],
  ["olio", "Olio d'oliva", ["olio-d-oliva"], ["olio extravergine"]],
  ["mozzarella", "Mozzarella", ["mozzarella-fiordilatte", "mozzarella-per-pizza"]],
  ["parmigiano", "Parmigiano reggiano", ["parmigiano-reggiano"], ["parmigiano"]],
  ["pasta", "Pasta", ["pasta-secca", "pasta-cotta", "pasta-integrale-secca", "pasta-integrale-cotta"]],
  ["riso", "Riso", ["riso-bianco-crudo", "riso-bianco-lessato", "riso-tondo-crudo", "riso-tondo-lessato"]],
  ["patata", "Patata", ["patata-cruda", "patata-lessa"]],
  ["carota", "Carota", ["carota-cruda", "carota-cotta"]],
  ["sedano", "Sedano", ["sedano-crudo"]],
  ["zucchina", "Zucchina", ["zucchina-cruda", "zucchina-lessata"]],
  ["melanzana", "Melanzana", ["melanzana-cruda"]],
  ["peperone", "Peperone", ["peperone-rosso-crudo", "peperone-giallo-crudo", "peperone-verde-crudo"]],
  ["spinaci", "Spinaci", ["spinaci-crudi", "spinaci-lessati"]],
  ["funghi", "Funghi champignon", ["funghi-champignon-crudi", "funghi-champignon-lessati"], ["funghi", "champignon"]],
  ["limone", "Limone", ["limone-crudo", "succo-di-limone"]],
  ["prezzemolo", "Prezzemolo", ["prezzemolo-fresco"]],
  ["rosmarino", "Rosmarino", ["rosmarino-fresco"]],
  ["timo", "Timo", ["timo-fresco"]],
  ["origano", "Origano", ["origano-secco"]],
  ["zenzero", "Zenzero", ["zenzero-fresco"]],
  ["burro", "Burro", ["burro"]],
  ["panna", "Panna fresca", ["panna-fresca"], ["panna"]],
  ["uovo", "Uova", ["uovo-intero-crudo", "uovo-sodo"], ["uovo"]],
  ["ricotta", "Ricotta", ["ricotta-intera"]],
  ["gorgonzola", "Gorgonzola", ["gorgonzola"]],
  ["pecorino", "Pecorino romano", ["pecorino-romano"], ["pecorino"]],
  ["pancetta", "Pancetta", ["pancetta-affumicata-cruda", "maiale-pancetta-fresca-cruda"]],
  ["pollo", "Pollo", ["pollo-petto-crudo", "pollo-petto-cotto", "pollo-coscia-con-pelle-cruda", "pollo-intero-crudo"]],
  ["salmone", "Salmone", ["salmone-allevamento-crudo", "salmone-allevamento-cotto", "salmone-affumicato"]],
  ["tonno", "Tonno", ["tonno-fresco-crudo", "tonno-al-naturale", "tonno-sott-olio"]],
  ["gamberi", "Gamberi", ["gamberi-crudi", "gamberi-lessati"]],
  ["ceci", "Ceci", ["ceci-secchi", "ceci-lessati", "ceci-in-scatola"]],
  ["lenticchie", "Lenticchie", ["lenticchie-secche", "lenticchie-lessate"]],
  ["fagioli", "Fagioli", ["fagioli-cannellini-secchi", "fagioli-cannellini-lessati", "fagioli-cannellini-in-scatola", "fagioli-borlotti-lessati"]],
  ["mela", "Mela", ["mela-cruda"]],
  ["pera", "Pera", ["pera-cruda"]],
  ["banana", "Banana", ["banana-cruda"]],
  ["arancia", "Arancia", ["arancia-cruda"]],
  ["fragola", "Fragole", ["fragola-cruda"], ["fragola"]],
  ["cioccolato", "Cioccolato fondente", ["cioccolato-fondente-45", "cioccolato-fondente-70"], ["cioccolato"]],
  ["miele", "Miele", ["miele"]],
  ["cannella", "Cannella", ["cannella"]],
  ["mandorle", "Mandorle", ["mandorle"]],
  ["noci", "Noci", ["noci"]],
  ["nocciole", "Nocciole", ["nocciole"]],
  ["pinoli", "Pinoli", ["pinoli"]],
  ["uvetta", "Uvetta", ["uvetta-sultanina"], ["uva sultanina"]],
  ["yogurt", "Yogurt naturale", ["yogurt-intero-naturale", "yogurt-magro-naturale", "yogurt-greco-intero"], ["yogurt"]],
  ["avocado", "Avocado", ["avocado-crudo"]],
  ["finocchio", "Finocchio", ["finocchio-crudo"]],
  ["rucola", "Rucola", ["rucola-cruda"]],
  ["capperi", "Capperi", ["capperi"]],
  ["olive", "Olive nere", ["olive-nere"], ["olive"]],
  ["acciughe", "Acciughe", ["acciughe-crude", "acciughe-sott-olio"], ["alici"]],
  ["balsamico", "Aceto balsamico", ["aceto-balsamico"]],
  ["zucca", "Zucca", ["zucca-cruda"]],
  ["cavolfiore", "Cavolfiore", ["cavolfiore-crudo", "cavolfiore-lessato"]],
  ["broccolo", "Broccoli", ["broccolo-crudo", "broccolo-lessato"], ["broccolo"]],
  ["noce-moscata", "Noce moscata", ["noce-moscata"]],
  ["zafferano", "Zafferano", ["zafferano"]],
  ["peperoncino", "Peperoncino", ["peperoncino-rosso-crudo", "peperoncino-in-polvere"]],
  ["curry", "Curry in polvere", ["curry-in-polvere"], ["curry"]],
  ["cumino", "Cumino", ["cumino"]],
  ["pepe", "Pepe nero", ["pepe-nero"], ["pepe"]],
  ["piselli", "Piselli", ["piselli-freschi-crudi", "piselli-surgelati"]],
  ["asparagi", "Asparagi", ["asparagi-crudi"]],
  ["cetriolo", "Cetriolo", ["cetriolo-crudo"]],
];

/** Fasce: 3 classico, 2 buono, 1 possibile. Sono assegnate a mano, non misurate. */
export const SAMPLE_TIERS: Readonly<Record<1 | 2 | 3, number>> = { 3: 0.9, 2: 0.7, 1: 0.5 };

// Una riga per alimento: «chiave: altra=fascia …». Ogni coppia vale nei due sensi; se compare due volte vale la fascia
// più alta.
const PAIRS = `
pomodoro: basilico=3 aglio=3 olio=3 mozzarella=3 origano=3 pasta=3 melanzana=3 cipolla=2 capperi=2 olive=2 peperoncino=2 zucchina=2 parmigiano=2 acciughe=2 cetriolo=2 rucola=2 tonno=2 prezzemolo=1 timo=2 uovo=2 ricotta=2 fagioli=2 ceci=2 lenticchie=2 sedano=2 avocado=3 balsamico=2 pancetta=2 gamberi=2 cumino=1 riso=1 curry=1 pollo=1
basilico: pinoli=3 parmigiano=3 mozzarella=3 aglio=2 olio=2 pasta=2 fragola=2 zucchina=2 melanzana=2 limone=1 ricotta=2 patata=1
aglio: olio=3 prezzemolo=3 peperoncino=3 rosmarino=3 gamberi=3 funghi=3 broccolo=3 spinaci=2 patata=2 pasta=2 acciughe=2 pollo=2 ceci=2 melanzana=2 cipolla=1 limone=1 zenzero=2 yogurt=2 noci=2 pinoli=2 cavolfiore=2 fagioli=2 lenticchie=2 cetriolo=1 capperi=1 origano=2
cipolla: carota=3 sedano=3 lenticchie=3 patata=2 peperone=2 pollo=2 funghi=2 riso=2 zucca=2 timo=2 burro=1 uovo=1 tonno=2 fagioli=2 uvetta=2 curry=2 balsamico=2 pancetta=2 piselli=2 avocado=2 acciughe=2 cetriolo=2 capperi=1 zenzero=1 finocchio=1 cumino=1
carota: sedano=3 zenzero=3 cumino=3 arancia=2 miele=2 timo=2 prezzemolo=1 curry=2 lenticchie=2 ceci=2 limone=1 mela=1 cannella=2 yogurt=1 patata=2 pollo=1 pasta=1 burro=2 uvetta=2 riso=1 rosmarino=1
sedano: mela=2 noci=2 patata=2 tonno=1 gorgonzola=2 lenticchie=2 fagioli=2 pollo=2 limone=1 prezzemolo=2
olio: limone=2 rosmarino=2 origano=2 peperoncino=2 pasta=2 ceci=2 tonno=1 balsamico=2 broccolo=1 rucola=1 avocado=1 melanzana=2 fagioli=2 capperi=1 mozzarella=1 cioccolato=1
mozzarella: rucola=2 olive=2 origano=2 melanzana=3 zucchina=1 peperone=1 acciughe=2 pasta=2 peperoncino=1
limone: prezzemolo=2 salmone=3 gamberi=3 pollo=2 rucola=2 finocchio=2 zenzero=2 miele=2 yogurt=1 capperi=2 spinaci=1 burro=1 tonno=2 timo=2 ricotta=2 asparagi=2 broccolo=1 acciughe=1 avocado=3 uovo=1 piselli=1 cavolfiore=1 mandorle=1 pinoli=1 pepe=1 origano=1 zafferano=1 arancia=1 fragola=1 mela=1 cetriolo=1 pera=1
rosmarino: patata=3 pollo=3 timo=2 ceci=2 fagioli=3 funghi=2 zucca=2 arancia=1 olive=1 miele=1 pancetta=1
timo: pollo=3 funghi=3 patata=2 lenticchie=2 miele=2 pomodoro=2
prezzemolo: pollo=1 patata=2 gamberi=2 pasta=1 lenticchie=2 uovo=2 funghi=2 acciughe=2 capperi=2 tonno=1 ceci=1
parmigiano: pasta=3 burro=2 uovo=2 rucola=3 riso=3 funghi=2 pera=2 spinaci=2 zucca=2 pinoli=2 noci=2 melanzana=2 balsamico=3 patata=1 broccolo=1 pancetta=2 asparagi=3 cavolfiore=2 finocchio=2 piselli=1
burro: uovo=2 patata=2 riso=2 funghi=2 spinaci=2 mela=2 cannella=1 pera=1 cioccolato=2 pasta=1 pollo=1 salmone=2 zucca=2 miele=1 asparagi=2 piselli=2 carota=2 noce-moscata=1 acciughe=2
uovo: spinaci=3 pancetta=3 pecorino=3 patata=2 pasta=2 zucchina=2 salmone=2 avocado=3 funghi=2 riso=1 ricotta=2 peperone=2 cioccolato=2 asparagi=3 pepe=2 piselli=1 tonno=2 noce-moscata=1 olive=1 rucola=1 broccolo=1 noci=1
pecorino: pancetta=3 pasta=3 pepe=3 pera=3 miele=3 noci=2 patata=1 rucola=2 peperoncino=1 zucca=1
pasta: pancetta=3 gamberi=2 tonno=2 zucchina=2 melanzana=2 funghi=2 broccolo=2 ceci=2 acciughe=2 peperoncino=2 pepe=2 spinaci=1 ricotta=2 salmone=2 zucca=1 pollo=1 cavolfiore=2 piselli=2 fagioli=2 gorgonzola=2 noci=1 pinoli=1 panna=1
riso: zafferano=3 funghi=3 zucca=3 piselli=3 pollo=2 gamberi=2 spinaci=1 limone=1 zenzero=1 peperone=2 salmone=1 curry=2 gorgonzola=2 asparagi=2
zafferano: gamberi=2 zucchina=2 pollo=1 patata=1 pasta=1
patata: pancetta=2 pollo=2 spinaci=1 cavolfiore=2 pepe=1 salmone=1 tonno=1 ceci=1 cumino=2 curry=2 gorgonzola=2 panna=1 noce-moscata=1 olive=1 acciughe=1 broccolo=1 rucola=1
zucchina: gamberi=2 limone=1 ricotta=3 peperone=2 melanzana=3 pollo=1 origano=1 pinoli=1
melanzana: peperone=3 ricotta=2 origano=2 yogurt=2 pinoli=1 uvetta=1 capperi=2 balsamico=1 curry=1
peperone: acciughe=2 capperi=2 tonno=1 olive=2 origano=2 pollo=2 peperoncino=1
spinaci: ricotta=3 noce-moscata=3 pinoli=2 uvetta=2 salmone=2 pollo=1 funghi=2 yogurt=1 mandorle=1 pancetta=2 panna=2 ceci=2 lenticchie=2 zenzero=1 curry=1 gorgonzola=1
funghi: pollo=2 patata=2 panna=3 noce-moscata=1 pecorino=1 pinoli=1 pancetta=1
panna: salmone=3 pancetta=2 cioccolato=3 fragola=3 gorgonzola=3 pepe=1 pollo=1 cannella=1 noce-moscata=2 piselli=1
gorgonzola: pera=3 noci=3 miele=3 mela=2 rucola=2 balsamico=2 spinaci=1 patata=2
ricotta: miele=3 pera=2 cioccolato=3 fragola=2 noce-moscata=2 uvetta=2 zucca=2 cannella=2 arancia=2 pinoli=1 pepe=1 mandorle=1 piselli=1 asparagi=1 limone=2
salmone: finocchio=3 avocado=2 capperi=2 zenzero=2 miele=2 cetriolo=2 pepe=1 yogurt=1 broccolo=1 pasta=2 rucola=1 asparagi=2
tonno: fagioli=3 capperi=3 olive=2 avocado=1 ceci=2 rucola=2 finocchio=1 zenzero=1 cipolla=2
gamberi: peperoncino=3 avocado=2 zenzero=2 finocchio=1 rucola=2 olio=1 cetriolo=1
pollo: peperone=2 zenzero=2 curry=3 yogurt=2 zucchina=1 olive=1 mandorle=1 arancia=1 peperoncino=1 miele=1 cannella=1 uvetta=1 finocchio=1
ceci: spinaci=2 cumino=3 curry=2 zucca=2 peperoncino=1 yogurt=1 pasta=2
lenticchie: pancetta=2 zenzero=1 curry=2 zucca=1 cumino=2 spinaci=2 riso=1
fagioli: pancetta=2 peperoncino=2 pomodoro=2
mela: cannella=3 miele=2 noci=3 uvetta=3 zenzero=2 cioccolato=2 yogurt=2 mandorle=2 pera=1 finocchio=2 arancia=1 banana=1 rucola=1 curry=1
pera: cioccolato=3 noci=2 cannella=2 miele=2 rucola=2 zenzero=2 mandorle=2 nocciole=2 balsamico=1 finocchio=1
banana: cioccolato=3 nocciole=2 yogurt=3 miele=2 cannella=2 mandorle=2 noci=2 arancia=1 fragola=2
arancia: cioccolato=3 finocchio=3 cannella=2 miele=2 mandorle=2 zenzero=2 yogurt=1 rucola=1 olive=1 fragola=1 nocciole=1
fragola: cioccolato=3 balsamico=3 yogurt=3 miele=2 mandorle=1 rucola=1 pepe=1
cioccolato: nocciole=3 mandorle=3 peperoncino=2 cannella=2 noci=2 zenzero=1 yogurt=1 miele=1 pinoli=1 pepe=1 uvetta=2
miele: yogurt=3 noci=3 mandorle=2 nocciole=2 zenzero=3 cannella=2 balsamico=1 carota=2
yogurt: cetriolo=3 cannella=1 mandorle=2 noci=2 uvetta=2 curry=2 zenzero=1 avocado=1 carota=1 cumino=1 nocciole=1
cannella: zucca=2 mandorle=1 uvetta=2 zenzero=2 noci=1
mandorle: uvetta=2 broccolo=2 basilico=1
noci: arancia=1 rucola=2 ricotta=2 pasta=1
nocciole: zucca=2 gorgonzola=1 ricotta=1 cannella=1 mela=1
pinoli: spinaci=2 uvetta=3 rucola=2 cavolfiore=2 melanzana=1 ricotta=1 miele=1 funghi=1
uvetta: cavolfiore=2 zucca=1 pollo=1 curry=2 capperi=1 acciughe=1 finocchio=1 riso=1 noci=2
avocado: limone=3 pomodoro=3 cetriolo=2 peperoncino=2 rucola=2 salmone=2 gamberi=2 uovo=3
finocchio: olive=2 pera=1 noci=1 pomodoro=1 rucola=2 pancetta=1 tonno=1 gamberi=1 salmone=3 arancia=3
rucola: pera=2 noci=2 pinoli=2 balsamico=3 mozzarella=2 fragola=1 pecorino=2 parmigiano=3 cetriolo=1 salmone=1
capperi: olive=3 melanzana=2 cipolla=1 patata=1 acciughe=2 cavolfiore=2 limone=2 pomodoro=2 prezzemolo=2
olive: arancia=1 pomodoro=2 finocchio=2 cetriolo=1 rosmarino=1 acciughe=2 cavolfiore=2 pollo=1
acciughe: peperoncino=2 cavolfiore=3 broccolo=3 pomodoro=2 peperone=2 patata=1
balsamico: parmigiano=3 pera=1 ricotta=1 noci=1 cipolla=2 pomodoro=2 miele=1
zucca: noce-moscata=3 pancetta=2 curry=2 peperoncino=1 zenzero=3 rosmarino=2 ricotta=2 parmigiano=2 cannella=2 pasta=1
cavolfiore: peperoncino=2 curry=2 noce-moscata=2 limone=1 aglio=2
broccolo: peperoncino=3 limone=1 pinoli=1 zenzero=2 salmone=1 pasta=2
noce-moscata: spinaci=3 ricotta=2 panna=2 cavolfiore=2 patata=1
peperoncino: pancetta=2 pomodoro=2 acciughe=2 limone=1 patata=1 zenzero=2
curry: spinaci=1 zenzero=2 pomodoro=1 melanzana=1 patata=2 cipolla=2 yogurt=2
cumino: patata=2 pomodoro=1 yogurt=1 cavolfiore=1
pepe: pecorino=3 pasta=2 patata=1 fragola=1 salmone=1 uovo=2 pancetta=2 panna=1 limone=1 pera=1
piselli: pancetta=3 riso=3 pasta=2 cipolla=2 burro=2 prezzemolo=1 limone=1
asparagi: uovo=3 parmigiano=3 burro=2 limone=2 salmone=2 pancetta=2 riso=2 ricotta=1 pasta=1 olio=1
cetriolo: yogurt=3 pomodoro=2 aglio=1 limone=1 salmone=2 olive=1 avocado=2 cipolla=2 peperone=1 zenzero=1 gamberi=1
`;

function build(): TasteData {
  const foods: TasteFood[] = ROWS.map(([key, name, foodIds, aliases]) => ({
    key,
    name,
    foodIds,
    ...(aliases ? { aliases } : {}),
  }));
  const keys = new Set(foods.map((f) => f.key));
  const best = new Map<string, number>();
  for (const line of PAIRS.split("\n")) {
    const text = line.trim();
    if (text === "") continue;
    const [head, rest = ""] = text.split(":");
    const a = (head ?? "").trim();
    if (!keys.has(a)) throw new Error(`insieme di prova: chiave sconosciuta «${a}»`);
    for (const item of rest.trim().split(/\s+/)) {
      const [b = "", t = ""] = item.split("=");
      const tier = Number(t);
      if (!keys.has(b) || b === a || (tier !== 1 && tier !== 2 && tier !== 3)) {
        throw new Error(`insieme di prova: voce non valida «${a}: ${item}»`);
      }
      const id = a < b ? `${a}|${b}` : `${b}|${a}`;
      best.set(id, Math.max(best.get(id) ?? 0, SAMPLE_TIERS[tier]));
    }
  }
  const neighbors: Record<string, [string, number][]> = {};
  for (const [id, score] of best) {
    const [a = "", b = ""] = id.split("|");
    (neighbors[a] ??= []).push([b, score]);
    (neighbors[b] ??= []).push([a, score]);
  }
  for (const list of Object.values(neighbors)) list.sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  return { source: "sample", version: "prova-2026-11-17", foods, neighbors };
}

export const SAMPLE_TASTE_DATA: TasteData = build();
