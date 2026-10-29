import Image from "next/image";
import { CHARACTER_PRESETS } from "../../shared/characters";
import styles from "./flipbook-demo.module.css";

/** Original landing composition, with Ichika and an empty slot for her upcoming animation. */
export function FlipbookDemo() {
  const ichika = CHARACTER_PRESETS.ichika;

  return (
    <figure id="flipbook-demo" className={styles.demo} aria-label="Ichika character reference" data-flipbook-demo="">
      <div className={styles.scene}>
        <div className={styles.reference}>
          <div className={styles.photo}>
            <Image src={`/characters/${ichika.fileName}`} alt={ichika.alt} width={ichika.width} height={ichika.height} style={{ aspectRatio: "3 / 5", objectFit: "contain", backgroundColor: "#fff" }} loading="eager" unoptimized />
          </div>
          <span className={styles.referenceLabel}>It starts with a character.</span>
        </div>
        <div className={styles.doodle} aria-hidden="true">
          <span>a little life</span>
          <svg width="72" height="48" viewBox="0 0 72 48" fill="none"><path d="M5 9C16 35 48 39 65 17M51 19l15-4-1 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div className={styles.result} aria-hidden="true">
          <div className={styles.player}>
            <div style={{ aspectRatio: "9 / 16" }} />
          </div>
        </div>
      </div>
      <figcaption className={styles.caption}>Your character. A whole new way to move.</figcaption>
    </figure>
  );
}
