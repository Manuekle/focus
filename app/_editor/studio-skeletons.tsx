import { Skeleton } from "../../components/ui/skeleton";
import styles from "./studio-skeletons.module.css";

/** Saved projects or animations on their way: rows shaped like the list. */
export function SidebarListSkeleton({ label }: { readonly label: string }) {
  return (
    <div className={styles.list} role="status" aria-label={label}>
      {[0, 1, 2].map((row) => (
        <div key={row} className={styles.row}>
          <Skeleton className={styles.poster} delay={row * 120} />
          <div className={styles.lines}>
            <Skeleton shape="text" style={{ width: `${78 - row * 14}%` }} delay={row * 120 + 40} />
            <Skeleton shape="text" style={{ width: "46%", height: 8 }} delay={row * 120 + 80} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The video editor while the clip and its project open: the stage on the left, the controls on the right. */
export function EditorSkeleton() {
  return (
    <div className={styles.editor} role="status" aria-label="Opening your clip">
      <div className={styles.preview}>
        <Skeleton className={styles.stage} />
        <div className={styles.transport}>
          <Skeleton shape="round" style={{ width: 28, height: 28 }} delay={80} />
          <Skeleton shape="text" style={{ width: 64 }} delay={120} />
          <Skeleton shape="text" style={{ flex: 1, height: 4 }} delay={160} />
        </div>
        <div className={styles.lines}>
          <Skeleton shape="text" style={{ width: 160 }} delay={200} />
          <Skeleton shape="text" style={{ width: 120, height: 8 }} delay={240} />
        </div>
      </div>
      <div className={styles.controls}>
        <Skeleton shape="round" style={{ height: 36 }} delay={120} />
        <Skeleton shape="text" style={{ width: "62%" }} delay={160} />
        <Skeleton shape="text" style={{ width: 120, marginTop: 8 }} delay={200} />
        <Skeleton style={{ height: 118, borderRadius: 14 }} delay={240} />
        <div className={styles.chips}>
          {[150, 190, 132].map((width, index) => <Skeleton key={width} shape="round" style={{ width, height: 26 }} delay={280 + index * 40} />)}
        </div>
        <Skeleton shape="round" style={{ height: 40, marginTop: 4 }} delay={400} />
      </div>
    </div>
  );
}
