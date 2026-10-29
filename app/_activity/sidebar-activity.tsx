"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { AlertCircleIcon, Cancel01Icon, InformationCircleIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { ProgressMeter } from "../../components/ui/progress-meter";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Spinner } from "../../components/ui/spinner";
import { cn } from "../../lib/utils";
import { dismissActivity, getActivities, getServerActivities, subscribeActivities, type Activity } from "./activity-store";
import shell from "../editor/studio.module.css";
import styles from "./sidebar-activity.module.css";

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
      <p className={styles.state} data-state={activity.state}>{LABEL[activity.state]}</p>
      {activity.detail !== LABEL[activity.state] && activity.detail !== "Completed" ? <p className={styles.detail}>{activity.detail}</p> : null}
      {activity.state === "running" && percent !== null ? <ProgressMeter size="sm" value={percent} aria-label={`${activity.title} progress`} aria-valuetext={`${percent}%`} /> : null}
    </div>
  </>;
}

export function SidebarActivity() {
  const activities = useSyncExternalStore(subscribeActivities, getActivities, getServerActivities);
  const running = activities.filter((activity) => activity.state === "running").length;
  const settled = activities.filter((activity) => activity.state !== "running");
  const announcement = [running ? `${running} ${running === 1 ? "task" : "tasks"} in progress.` : "", settled.length ? `${settled[0].title}: ${LABEL[settled[0].state]}.` : ""].filter(Boolean).join(" ");

  return <section className={styles.activity} aria-label="Activity" data-slot="sidebar-activity" data-empty={activities.length === 0 ? "" : undefined}>
    <div className={styles.heading}>
      <h2 className={shell.sideLabel}>Activity</h2>
      {running > 0 ? <span className={styles.count}>{running} running</span> : null}
    </div>
    <p role="status" aria-atomic="true" className="sr-only">{announcement}</p>
    {activities.length === 0 ? <p className={styles.empty}>Your tasks and their progress appear here.</p> : <ScrollArea className={styles.list}>
      <ul className={styles.items}>
        {activities.map((activity) => <li key={activity.id} className={styles.item}>
          {activity.href ? <Link href={activity.href} prefetch={false} className={cn(styles.task, styles.link)} title={activity.detail}><ActivityContent activity={activity} /></Link> : <div className={styles.task}><ActivityContent activity={activity} /></div>}
          {activity.state !== "running" ? <Button variant="ghost" size="icon-sm" className={styles.dismiss} aria-label={`Dismiss ${activity.title}`} onClick={() => dismissActivity(activity.id)}>
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
          </Button> : null}
        </li>)}
      </ul>
    </ScrollArea>}
  </section>;
}
