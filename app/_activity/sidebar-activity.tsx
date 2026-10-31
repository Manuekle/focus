"use client";

import Link from "next/link";
import { useCallback, useState, useSyncExternalStore } from "react";
import { AlertCircleIcon, Cancel01Icon, InformationCircleIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { ProgressMeter } from "../../components/ui/progress-meter";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Spinner } from "../../components/ui/spinner";
import { cn } from "../../lib/utils";
import { dismissActivity, getActivities, getServerActivities, subscribeActivities, type Activity } from "./activity-store";
import shell from "../editor/studio.module.css";
import styles from "./sidebar-activity.module.css";

// Keep in step with `--exit` in sidebar-activity.module.css.
const EXIT_MS = 300;
const LABEL: Record<Activity["state"], string> = { running: "In progress", completed: "Completed", failed: "Failed", canceled: "Canceled", waiting: "Needs input" };

function ActivityContent({ activity }: { readonly activity: Activity }) {
  const percent = activity.progress === null ? null : Math.round(activity.progress * 100);
  return <>
    <span className={styles.icon} data-state={activity.state} aria-hidden="true">
      {activity.state === "running" ? <Spinner role="presentation" aria-label={undefined} /> : <HugeiconsIcon icon={activity.state === "completed" ? Tick02Icon : activity.state === "failed" ? AlertCircleIcon : activity.state === "waiting" ? InformationCircleIcon : Cancel01Icon} size={16} strokeWidth={1.75} />}
    </span>
    <div className={styles.content}>
      <div className={styles.titleRow}>
        <span className={styles.title}>{activity.title}</span>
        {activity.state === "running" && percent !== null ? <span className={styles.percent}>{percent}%</span> : null}
      </div>
      <div className={styles.meta} data-state={activity.state}>
        <span className={styles.state} data-state={activity.state}>{LABEL[activity.state]}</span>
        {activity.detail !== LABEL[activity.state] && activity.detail !== "Completed" ? <>
          <span className={styles.separator} aria-hidden="true">·</span>
          <span className={styles.detail}>{activity.detail}</span>
        </> : null}
      </div>
      {activity.state === "running" && percent !== null ? <ProgressMeter size="sm" value={percent} aria-label={`${activity.title} progress`} aria-valuetext={`${percent}%`} /> : null}
    </div>
  </>;
}

export function SidebarActivity() {
  const activities = useSyncExternalStore(subscribeActivities, getActivities, getServerActivities);
  const running = activities.filter((activity) => activity.state === "running").length;
  const settled = activities.filter((activity) => activity.state !== "running");
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  // Let the row collapse before it leaves the store; reduced motion removes it at once.
  const dismiss = useCallback((id: string) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { dismissActivity(id); return; }
    setLeaving((current) => new Set(current).add(id));
    window.setTimeout(() => {
      dismissActivity(id);
      setLeaving((current) => { const next = new Set(current); next.delete(id); return next; });
    }, EXIT_MS);
  }, []);
  const announcement = [running ? `${running} ${running === 1 ? "task" : "tasks"} in progress.` : "", settled.length ? `${settled[0].title}: ${LABEL[settled[0].state]}.` : ""].filter(Boolean).join(" ");

  return <section className={styles.activity} aria-label="Activity" data-slot="sidebar-activity" data-empty={activities.length === 0 ? "" : undefined}>
    <div className={styles.heading}>
      <h2 className={shell.sideLabel}>Activity</h2>
      {running > 0 ? <span className={styles.count}>{running} running</span> : null}
    </div>
    <p role="status" aria-atomic="true" className="sr-only">{announcement}</p>
    {activities.length === 0 ? <p className={styles.empty}>Your tasks and their progress appear here.</p> : <ScrollArea className={styles.list} viewportClassName={styles.listViewport}>
      <ul className={styles.items}>
        {activities.map((activity) => <li key={activity.id} className={styles.item} data-state={activity.state} data-leaving={leaving.has(activity.id) ? "" : undefined} aria-hidden={leaving.has(activity.id) || undefined}>
          <div className={styles.collapse}>
            <div className={styles.row}>
              {activity.href ? <Link href={activity.href} prefetch={false} className={cn(styles.task, styles.link)} title={activity.detail} tabIndex={leaving.has(activity.id) ? -1 : undefined}><ActivityContent activity={activity} /></Link> : <div className={styles.task} title={activity.detail}><ActivityContent activity={activity} /></div>}
              {activity.state !== "running" ? <button type="button" className={styles.dismiss} aria-label={`Dismiss ${activity.title}`} title="Dismiss" tabIndex={leaving.has(activity.id) ? -1 : undefined} onClick={() => dismiss(activity.id)}>
                <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
              </button> : null}
            </div>
          </div>
        </li>)}
      </ul>
    </ScrollArea>}
  </section>;
}
