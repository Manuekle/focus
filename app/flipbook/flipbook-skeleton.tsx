import { Skeleton } from "../../components/ui/skeleton";
import styles from "./flipbook.module.css";

/** The animation while it opens, in the editor's own grid: character, stage and strip, frame panel. */
export function FlipbookSkeleton() {
  return (
    <div className={styles.editor} role="status" aria-label="Opening your animation">
      <div className={styles.editorHead}>
        <div className={styles.skeletonLines}>
          <Skeleton shape="text" style={{ width: 132, height: 8 }} />
          <Skeleton shape="text" style={{ width: 280, height: 16 }} delay={40} />
        </div>
        <div className={styles.headActions}>
          <Skeleton shape="round" style={{ width: 104, height: 26 }} delay={80} />
          <Skeleton shape="round" style={{ width: 96, height: 30 }} delay={120} />
        </div>
      </div>
      <div className={styles.grid}>
        <div className={styles.columnSide}>
          <section className={styles.panel}>
            <Skeleton shape="text" style={{ width: 84, height: 12 }} delay={80} />
            <Skeleton className={styles.skeletonReference} delay={120} />
            <div className={styles.skeletonLines}>
              <Skeleton shape="text" style={{ width: "92%" }} delay={160} />
              <Skeleton shape="text" style={{ width: "70%" }} delay={200} />
            </div>
            <div className={styles.chips}>
              {[96, 132, 116].map((width, index) => <Skeleton key={width} shape="round" style={{ width, height: 26 }} delay={240 + index * 40} />)}
            </div>
          </section>
        </div>
        <div className={styles.columnMain}>
          <div className={styles.lightTable}>
            <Skeleton className={styles.skeletonStage} delay={60} />
          </div>
          <div className={styles.transport}>
            <div className={styles.transportGroup}>
              {[0, 1, 2, 3].map((index) => <Skeleton key={index} shape="round" style={{ width: 28, height: 28 }} delay={120 + index * 30} />)}
            </div>
            <Skeleton shape="text" style={{ width: 96 }} delay={240} />
          </div>
          <div className={styles.strip}>
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className={styles.skeletonThumb}>
                <Skeleton className={styles.stripThumb} delay={180 + index * 60} />
                <Skeleton shape="text" style={{ width: "70%", height: 8 }} delay={220 + index * 60} />
              </div>
            ))}
          </div>
        </div>
        <div className={styles.columnSide}>
          <section className={styles.panel}>
            <Skeleton shape="text" style={{ width: 140, height: 12 }} delay={120} />
            <Skeleton className={styles.inspect} delay={160} />
            <div className={styles.skeletonLines}>
              <Skeleton shape="text" style={{ width: "88%" }} delay={200} />
              <Skeleton shape="text" style={{ width: "64%" }} delay={240} />
            </div>
            <Skeleton style={{ height: 64, borderRadius: 14 }} delay={280} />
            <Skeleton shape="round" style={{ width: 160, height: 32 }} delay={320} />
          </section>
        </div>
      </div>
    </div>
  );
}
