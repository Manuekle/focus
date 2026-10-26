"use client";
import { useId, useMemo, useState, type ReactNode } from "react";
import { ArrowDown01Icon, ArrowUp01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../icons/icon";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Alert } from "../ui/alert";
import { SkeletonBar } from "../ai-elements/skeleton";
import { EmptyState } from "./empty-state";
import { useI18n } from "../../lib/i18n/provider";

export type DataColumn<T> = {
  readonly id: string; readonly header: string;
  readonly value: (row: T) => string | number;
  readonly render?: (row: T) => ReactNode;
  readonly sortable?: boolean;
  readonly align?: "left" | "right";
};
export type DataTableProps<T> = {
  readonly rows: readonly T[]; readonly columns: readonly DataColumn<T>[];
  readonly rowKey: (row: T) => string; readonly caption: string;
  readonly searchLabel?: string; readonly pageSize?: number;
  readonly loading?: boolean; readonly error?: string; readonly onRetry?: () => void;
  readonly emptyTitle?: string; readonly emptyDescription?: string;
};
const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLocaleLowerCase();
/** Client-side table for bounded collections. Load/sort large data on the server. */
export function DataTable<T>({rows, columns, rowKey, caption, searchLabel, pageSize=5, loading, error, onRetry, emptyTitle, emptyDescription}: DataTableProps<T>) {
  const {locale} = useI18n();
  const en = locale === "en";
  const id = useId();
  const [query, setQuery] = useState("");
  const [page,setPage] = useState(1);
  const [sort,setSort] = useState<{id:string; direction:1|-1}|null>(null);
  const filtered = useMemo(()=> {
    const result=rows.filter(row=>columns.some(column=>fold(String(column.value(row))).includes(fold(query))));
    if(!sort)return result;
    const column = columns.find(c=>c.id===sort.id);
    if(!column)return result;
    return [...result].sort((a,b)=> {
      const av=column.value(a),bv=column.value(b);
      return (typeof av === "number" && typeof bv === "number" ? av-bv : String(av).localeCompare(String(bv),locale,{numeric:true})) * sort.direction;
    });
  },[rows,columns,sort,query,locale]);
  const size=Math.max(1,pageSize);
  const pageCount=Math.max(1,Math.ceil(filtered.length/size));
  const current=Math.min(page,pageCount);
  const visible=filtered.slice((current-1)*size,current*size);
  const searching = Boolean(query.trim());
  const toggleSort = (column: DataColumn<T>) => { setSort(prev=>({id:column.id,direction:prev?.id===column.id && prev.direction===1?-1:1}));setPage(1); };
  return <div className="w-full overflow-hidden rounded-xl border border-border bg-card">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <p className="text-sm font-medium">{caption}</p>
      <div className="relative min-w-0">
        <HugeiconsIcon icon={Search01Icon} size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
        <label htmlFor={id} className="sr-only">{searchLabel ?? (en?"Search rows":"Buscar filas")}</label>
        <Input id={id} value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}} placeholder={searchLabel ?? (en?"Search…":"Buscar…")} className="w-full pl-9 sm:w-56" />
      </div>
    </div>
    {error ? <div className="p-4"><Alert tone="error" role="alert" title={en?"Unable to load data":"No se pudieron cargar los datos"} action={onRetry && <Button size="sm" variant="outline" onClick={onRetry}>{en?"Retry":"Reintentar"}</Button>}>{error}</Alert></div> : loading ?
      <div role="status" aria-label={en?"Loading rows":"Cargando filas"} className="space-y-5 p-5">{[1,2,3].map(n=><SkeletonBar key={n} className="h-4" width={`${100-n*9}%`} />)}</div> : <>
      <div className="x-fade w-full overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead><tr className="border-b border-border bg-muted/40">{columns.map(column=><th key={column.id} scope="col" aria-sort={sort?.id===column.id ? (sort.direction===1?"ascending":"descending") : undefined} className={`px-4 py-3 text-xs font-medium text-muted-foreground ${column.align==="right"?"text-right":""}`}>
            {column.sortable ? <button type="button" onClick={()=>toggleSort(column)} className="inline-flex cursor-pointer items-center gap-1.5 rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{column.header}<HugeiconsIcon icon={sort?.id===column.id && sort.direction===-1?ArrowUp01Icon:ArrowDown01Icon} size={13}/></button> : column.header}
          </th>)}</tr></thead>
          <tbody>{visible.map(row=><tr key={rowKey(row)} className="border-b border-border/60 last:border-0 hover:bg-muted/35">{columns.map(column=><td key={column.id} className={`px-4 py-3.5 ${column.align==="right"?"text-right tabular-nums":""}`}>{column.render?.(row) ?? column.value(row)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {!filtered.length && <EmptyState figure={false} title={searching?(en?"No matching results":"No hay coincidencias"):(emptyTitle ?? (en?"No items yet":"Todavía no hay elementos"))} description={searching?(en?"Try a different name or clear the search.":"Prueba otro nombre o limpia la búsqueda."):(emptyDescription ?? (en?"New items will appear here.":"Los nuevos elementos aparecerán aquí."))} action={searching && <Button variant="outline" size="sm" onClick={()=>setQuery("")}>{en?"Clear search":"Limpiar búsqueda"}</Button>} />}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        <p role="status" className="text-xs tabular-nums text-muted-foreground">{filtered.length} {en?"results":"resultados"} · {en?"Page":"Página"} {current}/{pageCount}</p>
        <div className="flex gap-2"><Button size="sm" variant="outline" disabled={current===1} onClick={()=>setPage(current-1)}>{en?"Previous":"Anterior"}</Button><Button size="sm" variant="outline" disabled={current===pageCount} onClick={()=>setPage(current+1)}>{en?"Next":"Siguiente"}</Button></div>
      </div>
    </>}
  </div>;
}
