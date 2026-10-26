"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search01Icon, ArrowRight01Icon, ArrowUpRight01Icon, VolumeHighIcon, VolumeMute01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { FocusMark } from "../../components/icons/focus-mark";
import { ThemeToggle } from "../../components/motion/theme-toggle";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { useI18n } from "../../lib/i18n/provider";
import { useSound } from "../../components/sound-provider";
import { cn } from "../../lib/utils";
import { CatalogI18nProvider, useCatalogT } from "../_lib/catalog-i18n";
import { CopyButton, DemoBlock, ExportList, ImportLine, PropsTable } from "../_lib/kit";
import { getCatalog } from "../_registry";
import { WorkspacePreview } from "./workspace-preview";
import type { Entry, Section } from "../_lib/types";

const fold=(value:string)=>value.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase();
function matches(entry:Entry,query:string){const text=fold([entry.name,entry.source,entry.desc,...(entry.exports??[])].join(" "));return fold(query).split(/\s+/).filter(Boolean).every(word=>text.includes(word));}
function EntryBlock({entry}:{readonly entry:Entry}) {
  const {locale,ct:t}=useCatalogT(); const en=locale==="en";
  return <article id={entry.id} className="focus-entry">
    <header className="mb-5"><div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><h3 className="text-xl font-semibold tracking-[-0.02em]">{entry.name}</h3><code className="text-[10px] text-muted-foreground">{entry.source}</code></div><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{entry.desc}</p></header>
    <div className="mb-5"><ImportLine line={entry.importLine}/></div>
    {entry.notes?.length ? <div className="focus-note"><p className="mb-2 text-xs font-medium">{en?"Usage notes":"Antes de usar"}</p><ul className="space-y-1.5">{entry.notes.map(note=><li key={note} className="text-xs leading-5 text-muted-foreground">{note}</li>)}</ul></div>:null}
    <div className="flex flex-col gap-4">{entry.demos.map(demo=><DemoBlock key={demo.id} demo={demo}/>)}</div>
    {entry.props?.length?<div className="mt-5"><h4 className="mb-2 text-xs font-medium">{t("shell.props")}</h4><PropsTable props={entry.props}/></div>:null}
    {entry.exports?.length?<div className="mt-4"><h4 className="mb-2 text-xs font-medium">{t("shell.exports")}</h4><ExportList names={entry.exports}/></div>:null}
  </article>;
}
function Overview({sections,onSelect}:{readonly sections:readonly Section[];readonly onSelect:(id:string)=>void}) {
  const {locale}=useCatalogT(); const en=locale==="en";
  const count=sections.reduce((sum,section)=>sum+section.entries.length,0);
  return <>
    <header className="focus-intro"><div className="focus-eyebrow"><span className="focus-status-dot"/>{en?"A foundation for your next product":"Una base para tu próximo producto"}</div><h1>{en?<>Clarity,<br/>by design.</>:<>Claridad,<br/>por sistema.</>}</h1><p>{en?"A complete visual language. Thoughtful components, consistent patterns and room for your ideas.":"Un lenguaje visual completo. Componentes cuidados, patrones coherentes y espacio para tus ideas."}</p><div className="mt-6 flex flex-wrap gap-2"><Button onClick={()=>onSelect("ui-controls")}>{en?"Explore components":"Explorar componentes"}<HugeiconsIcon icon={ArrowRight01Icon} size={15}/></Button><Button variant="outline" asChild><a href="/guide">{en?"Start building":"Empezar a construir"}<HugeiconsIcon icon={ArrowUpRight01Icon} size={14}/></a></Button></div></header>
    <div className="focus-system-preview"><div><div className="focus-preview-label"><span>{en?"THE SYSTEM, AT WORK":"EL SISTEMA, EN ACCIÓN"}</span><span>{en?"Try it":"Pruébalo"} ↗</span></div><WorkspacePreview/></div><div className="focus-specimens"><button type="button" onClick={()=>onSelect("foundations")} className="focus-type-specimen"><div className="focus-specimen-top"><span>{en?"Typography":"Tipografía"}</span><span className="font-mono">Aa / 01</span></div><span className="focus-aa">Aa<span>.</span></span><div className="flex items-center justify-between text-xs"><span>Optimistic Display</span><span className="font-mono text-muted-foreground">300 — 800</span></div></button><button type="button" onClick={()=>onSelect("foundations")} className="focus-color-specimen"><span className="text-xs font-medium">{en?"Color with purpose":"Color con propósito"}</span><div className="focus-palette">{["var(--primary)","var(--foreground)","var(--muted-foreground)","var(--muted)"].map(color=><span key={color} style={{background:color}}/>)}</div><span className="font-mono text-[10px] text-muted-foreground">BLUE · INK · SLATE · PAPER</span></button></div></div>
    <div className="focus-summary"><div><strong>{count}</strong><span>{en?"documented entries":"entradas documentadas"}</span></div><div><strong>9</strong><span>{en?"system areas":"áreas del sistema"}</span></div><div><strong>Aa</strong><span>{en?"Optimistic Display":"Optimistic Display"}</span></div><div><strong>◐</strong><span>{en?"light & dark":"claro y oscuro"}</span></div></div>
    <section className="focus-library"><div className="focus-section-heading"><div><h2>{en?"The library":"La biblioteca"}</h2><p>{en?"Start with the basics. Compose the rest.":"Empieza por lo esencial. Compón lo demás."}</p></div><span className="font-mono text-[10px] text-muted-foreground">@focus/ui</span></div><div className="focus-section-grid">{sections.map(section=><button key={section.id} type="button" className="focus-section-card" onClick={()=>onSelect(section.id)}><div className="flex items-center justify-between gap-3"><h3>{section.title}</h3><span className="focus-count">{section.entries.length}</span></div><p>{section.entries.slice(0,4).map(entry=>entry.name).join(" · ")}</p><HugeiconsIcon icon={ArrowRight01Icon} size={16} className="mt-4 text-muted-foreground"/></button>)}</div></section>
    <aside className="focus-install"><div><p className="text-sm font-medium">{en?"A library you can make your own":"Una biblioteca que puedes hacer tuya"}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{en?"Typed source, direct imports and portable tokens.":"Código tipado, imports directos y tokens portables."}</p></div><div className="flex min-w-0 items-center gap-3"><code className="overflow-x-auto text-[11px]">import &#123; Button &#125; from &quot;@focus/ui/ui/button&quot;</code><CopyButton value={'import { Button } from "@focus/ui/ui/button";'}/></div></aside>
  </>;
}
function CatalogInner() {
  const {locale,setLocale,ct:t}=useCatalogT();const en=locale==="en";
  const {setLocale:setUiLocale}=useI18n();const {enabled,setEnabled}=useSound();
  const [selected,setSelected]=useState("overview");const [query,setQuery]=useState("");
  const searchRef=useRef<HTMLInputElement>(null);
  const sections=useMemo(()=>getCatalog(locale),[locale]);
  const selectedSection=sections.find(section=>section.id===selected);
  const filtered=useMemo(()=>query.trim()?sections.map(section=>({...section,entries:section.entries.filter(entry=>matches(entry,query))})).filter(section=>section.entries.length):selectedSection?[selectedSection]:[],[query,sections,selectedSection]);
  useEffect(()=>{setUiLocale(locale);document.documentElement.lang=locale;},[locale,setUiLocale]);
  useEffect(()=>{const id=new URLSearchParams(window.location.search).get("section");if(id && getCatalog().some(section=>section.id===id))setSelected(id);},[]);
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{const target=event.target as HTMLElement|null;if(event.key!=="/"||event.metaKey||event.ctrlKey||event.altKey||target?.isContentEditable||target?.closest('input,textarea,select,[role="combobox"]'))return;event.preventDefault();searchRef.current?.focus();};
    window.addEventListener("keydown",handler);return()=>window.removeEventListener("keydown",handler);
  },[]);
  function select(id:string){setSelected(id);setQuery("");const url=new URL(window.location.href);url.searchParams.delete("section");if(id!=="overview")url.searchParams.set("section",id);url.hash="";window.history.replaceState(null,"",url);window.scrollTo({top:0,behavior:"instant"});}
  return <div className="focus-catalog"><a href="#focus-content" className="focus-skip">{en?"Skip to content":"Saltar al contenido"}</a>
    <aside className="focus-sidebar"><Link href="/" className="focus-brand" aria-label="Focus — Inicio"><FocusMark className="text-primary"/><div><strong>focus<span className="text-primary">.</span></strong><span>Design system</span></div></Link>
      <nav aria-label={en?"Library navigation":"Navegación de la biblioteca"} className="y-fade focus-navigation"><p className="focus-nav-label">{en?"GETTING STARTED":"PRIMEROS PASOS"}</p><button type="button" className={cn("focus-nav-link",selected==="overview"&&!query&&"is-active")} onClick={()=>select("overview")} aria-current={selected==="overview"&&!query?"page":undefined}>{en?"Overview":"Visión general"}<span>↗</span></button><a href="/guide" className="focus-nav-link">{en?"Installation & guide":"Instalación y guía"}</a><p className="focus-nav-label mt-7">{en?"LIBRARY":"BIBLIOTECA"}</p>{sections.map(section=><button key={section.id} type="button" className={cn("focus-nav-link",selected===section.id&&!query&&"is-active")} onClick={()=>select(section.id)} aria-current={selected===section.id&&!query?"page":undefined}>{section.title}<span>{section.entries.length}</span></button>)}</nav>
      <div className="focus-sidebar-footer"><div className="flex items-center gap-2"><span className="focus-status-dot"/><span className="text-xs font-medium">Focus 0.1</span></div><p>{en?"Made to work together.":"Diseñado para encajar."}</p><span className="font-mono text-[10px]">REACT 19 · TAILWIND 4</span></div>
    </aside>
    <div className="focus-main-shell"><header className="focus-topbar"><Link href="/" className="focus-mobile-brand" aria-label="Focus — Inicio"><FocusMark className="text-primary"/></Link><div className="focus-breadcrumb"><span>Workspace</span><span>/</span><strong>{query?(en?"Search":"Búsqueda"):selectedSection?.title??(en?"Overview":"Visión general")}</strong></div><div className="focus-search"><HugeiconsIcon icon={Search01Icon} size={16} className="text-muted-foreground"/><label htmlFor="focus-search" className="sr-only">{t("shell.filterLabel")}</label><Input id="focus-search" ref={searchRef} value={query} onChange={e=>{setQuery(e.target.value);window.scrollTo({top:0,behavior:"instant"});}} placeholder={en?"Find a component…":"Buscar un componente…"}/>{query?<button type="button" aria-label={t("shell.clearFilterLabel")} onClick={()=>setQuery("")}><HugeiconsIcon icon={Cancel01Icon} size={14}/></button>:<kbd>/</kbd>}</div><div className="focus-toolbar"><Button variant="ghost" size="icon-sm" aria-label={enabled?(en?"Mute interface sounds":"Silenciar sonidos"): (en?"Enable interface sounds":"Activar sonidos")} aria-pressed={enabled} onClick={()=>setEnabled(!enabled)}><HugeiconsIcon icon={enabled?VolumeHighIcon:VolumeMute01Icon} size={17}/></Button><Button variant="ghost" size="xs" onClick={()=>setLocale(en?"es":"en")} aria-label={en?"Cambiar a español":"Switch to English"} className="font-mono">{en?"ES":"EN"}</Button><ThemeToggle variant="circle-blur" start="top-right"/></div></header>
      <div className="focus-mobile-nav"><label className="sr-only" htmlFor="focus-section">{en?"Library section":"Sección de la biblioteca"}</label><Select value={selected} onValueChange={select}><SelectTrigger id="focus-section" className="w-full"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="overview">{en?"Overview":"Visión general"}</SelectItem>{sections.map(section=><SelectItem key={section.id} value={section.id}>{section.title}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="sm" asChild><a href="/guide">{en?"Guide":"Guía"}</a></Button></div>
      <main id="focus-content" className="focus-content" tabIndex={-1}>{selected==="overview"&&!query?<Overview sections={sections} onSelect={select}/>:<>
        <header className="focus-category-heading"><p className="focus-eyebrow">{en?"THE LIBRARY":"LA BIBLIOTECA"}</p><h1>{query?(en?"Search results":"Resultados de búsqueda"):selectedSection?.title}</h1><p>{query?`${filtered.reduce((sum,section)=>sum+section.entries.length,0)} ${en?"results for":"resultados para"} “${query}”`:selectedSection?.desc}</p></header>
        {!filtered.length?<div className="focus-no-results"><h2>{en?"No matching components":"No hay componentes que coincidan"}</h2><p>{en?"Try “button”, “date” or “table”.":"Prueba con «button», «fecha» o «tabla»."}</p><Button variant="outline" onClick={()=>setQuery("")}>{t("shell.clearFilter")}</Button></div>:filtered.map(section=><section key={section.id} aria-label={section.title}>{query&&<h2 className="mb-7 text-sm font-medium text-muted-foreground">{section.title}</h2>}<nav className="focus-entry-index" aria-label={en?"On this page":"En esta página"}>{section.entries.map(entry=><a key={entry.id} href={`#${entry.id}`}>{entry.name}</a>)}</nav>{section.entries.map(entry=><EntryBlock key={entry.id} entry={entry}/>)}</section>)}
      </>}</main><footer className="focus-footer"><span>Focus · Design system</span><span>{en?"A new identity. A shared foundation.":"Una identidad nueva. Una base compartida."}</span><a href="/guide">{en?"Documentation":"Documentación"} ↗</a></footer>
    </div>
  </div>;
}
export function Catalog(){return <CatalogI18nProvider><CatalogInner/></CatalogI18nProvider>;}
