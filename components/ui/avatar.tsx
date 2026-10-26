"use client";
import { useState } from "react";
import { cn } from "../../lib/utils";
const sizes = {sm: "size-7 text-[10px]", md:"size-9 text-xs", lg:"size-12 text-base"};
export type AvatarProps = { readonly name: string; readonly src?: string; readonly size?: keyof typeof sizes; readonly className?: string; readonly decorative?: boolean };
export function Avatar({name, src, size="md", className, decorative=false}: AvatarProps) {
  const [failedSource, setFailedSource] = useState<string | undefined>();
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join("").toLocaleUpperCase();
  return <span role={decorative?undefined:"img"} aria-label={decorative?undefined:name} aria-hidden={decorative||undefined} className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent font-medium text-accent-foreground ring-2 ring-card", sizes[size], className)}>
    {src && failedSource !== src ? <img src={src} alt="" className="size-full object-cover" onError={()=>setFailedSource(src)} /> : initials || "?"}
  </span>;
}
export function AvatarGroup({people, max=4, label="Personas"}: {readonly people: readonly AvatarProps[]; readonly max?: number; readonly label?: string}) {
  const limit = Math.max(1,max);
  return <div role="group" aria-label={label} className="flex items-center -space-x-2">
    {people.slice(0,limit).map((person,index)=><Avatar key={`${person.name}-${index}`} {...person} />)}
    {people.length>limit && <span className="relative grid size-9 place-items-center rounded-full bg-muted text-xs text-muted-foreground ring-2 ring-card" aria-label={`${people.length-limit} más`}>+{people.length-limit}</span>}
  </div>;
}
