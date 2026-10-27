import Link from "next/link";
import { Film01Icon, Video01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import styles from "./mode-switch.module.css";

/** Video editing or Flipbook animation. Rendered only when Flipbook is enabled. */
export function ModeSwitch({ current }: { readonly current: "video" | "flipbook" }) {
  return (
    <nav className={styles.modes} aria-label="Creation mode">
      <Link href="/editor" className={styles.mode} aria-current={current === "video" ? "page" : undefined}>
        <HugeiconsIcon icon={Video01Icon} size={14} strokeWidth={1.75} />Video
      </Link>
      <Link href="/flipbook" className={styles.mode} aria-current={current === "flipbook" ? "page" : undefined}>
        <HugeiconsIcon icon={Film01Icon} size={14} strokeWidth={1.75} />Flipbook
      </Link>
    </nav>
  );
}
