import type { ReactNode } from "react";
import { ProductFigure, type ProductFigureKind } from "../hairline/product-figure";
import { cn } from "../../lib/utils";
export function EmptyState({title, description, action, figure="empty-archive", className}: {
  readonly title: string; readonly description: string; readonly action?: ReactNode;
  readonly figure?: ProductFigureKind | false; readonly className?: string;
}) {
  return <div className={cn("flex flex-col items-center px-6 py-10 text-center",className)}>
    {figure && <ProductFigure kind={figure} className="mb-3 h-36 w-52" />}
    <h3 className="text-base font-semibold tracking-[-0.02em]">{title}</h3>
    <p className="mt-2 max-w-[32ch] text-sm leading-6 text-muted-foreground">{description}</p>
    {action && <div className="mt-5">{action}</div>}
  </div>;
}
