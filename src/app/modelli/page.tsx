import type { Metadata } from "next";
import Gallery from "./Gallery";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Modelli 3D",
  description: "Catalogo dei modelli a incisione generati dalle ricette.",
};

export default function ModelsPage() {
  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Modelli</h1>
        <p className={styles.count}>Catalogo</p>
      </header>
      <p className={styles.hint}>Trascina una figura per girarla. L&apos;id sotto ogni figura è quello della ricetta.</p>
      <Gallery />
    </main>
  );
}
