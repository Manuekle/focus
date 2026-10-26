"use client";

import { type CSSProperties, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Card({
  children,
  className,
  interactive = false,
  style,
  onClick,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly interactive?: boolean;
  readonly style?: CSSProperties;
  readonly onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)] overflow-hidden",
        interactive &&
          "transition duration-200 hover:shadow-[var(--shadow-elevated)] hover:border-input",
        className,
      )}
      style={style}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-3 px-5 pt-5 pb-4", className)}>
      {children}
    </div>
  );
}

export function CardBody({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <div className={cn("space-y-4 px-5 py-4", className)}>{children}</div>;
}

export function CardSeparator() {
  return <div className="mx-5 h-px bg-border" />;
}

export function CardTitle({
  children,
  className,
  as: Heading = "h3",
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly as?: "h2" | "h3";
}) {
  return (
    <Heading className={cn("min-w-0 max-w-full truncate text-sm font-medium sm:whitespace-normal", className)}>
      {children}
    </Heading>
  );
}

export function CardDescription({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <p className={cn("mt-0.5 min-w-0 max-w-full line-clamp-2 break-words text-xs text-muted-foreground sm:line-clamp-none", className)}>
      {children}
    </p>
  );
}
