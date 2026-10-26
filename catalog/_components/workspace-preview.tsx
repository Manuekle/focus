"use client";
import { useState } from "react";
import { Add01Icon, ArrowUpRight01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Checkbox } from "../../components/motion/checkbox";
import { AvatarGroup } from "../../components/ui/avatar";
import { ProgressMeter } from "../../components/ui/progress-meter";
import { SlidingTabs } from "../../components/ai-elements/sliding-tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../../components/ui/dialog";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { useToast } from "../../components/toast-provider";
import { useCatalogT } from "../_lib/catalog-i18n";

export function WorkspacePreview() {
  const {locale} = useCatalogT(); const en=locale==="en";
  const {toast}=useToast();
  const [tab,setTab]=useState("tasks");
  const [open,setOpen]=useState(false);const [title,setTitle]=useState("");
  const [tasks,setTasks]=useState([{id:1,es:"Definir la dirección visual",en:"Define visual direction",done:true},{id:2,es:"Construir componentes",en:"Build components",done:true},{id:3,es:"Dar forma a la siguiente idea",en:"Shape the next idea",done:false}]);
  const done=tasks.filter(task=>task.done).length;
  return <section className="focus-workspace" aria-label={en?"Interactive system preview":"Vista interactiva del sistema"}>
    <div className="focus-preview-top"><span className="focus-project-icon"><HugeiconsIcon icon={ArrowUpRight01Icon} size={18}/></span><div><p className="text-[13px] font-medium">{en?"Your next idea":"Tu próxima idea"}</p><p className="mt-0.5 text-xs text-muted-foreground">{en?"A space to make progress":"Un espacio para avanzar"}</p></div><Badge variant="secondary" className="ml-auto">{en?"In progress":"En curso"}</Badge></div>
    <div className="flex items-center justify-between gap-3 border-b border-border px-5 pb-4"><SlidingTabs value={tab} onValueChange={setTab} tabs={[{id:"tasks",label:en?"Tasks":"Tareas"},{id:"activity",label:en?"Activity":"Actividad"}]}/><AvatarGroup people={[{name:"Alex Morgan"},{name:"Sofía Torres"},{name:"Emma Chen"}]} label={en?"Project team":"Equipo del proyecto"}/></div>
    {tab==="tasks" ? <div className="focus-task-list">{tasks.map(task=><div key={task.id} className="focus-task"><Checkbox checked={task.done} onCheckedChange={checked=>setTasks(previous=>previous.map(t=>t.id===task.id?{...t,done:checked}:t))} label={en?task.en:task.es}/><span className="ml-auto font-mono text-[10px] text-muted-foreground">{String(task.id).padStart(2,"0")}</span></div>)}</div> : <div className="focus-activity"><HugeiconsIcon icon={Tick02Icon} size={18} className="text-primary"/><div><p className="text-sm">{en?"Visual direction approved":"Dirección visual aprobada"}</p><p className="mt-1 text-xs text-muted-foreground">{en?"Everything you need, in one place.":"Lo que necesitas, en un mismo lugar."}</p></div></div>}
    <div className="focus-preview-bottom"><div className="min-w-0 flex-1"><p className="mb-2 text-xs tabular-nums text-muted-foreground">{done}/{tasks.length} {en?"completed":"completadas"}</p><ProgressMeter value={done/tasks.length*100} aria-label={en?"Completed tasks":"Tareas completadas"}/></div>
      <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm"><HugeiconsIcon icon={Add01Icon} size={14}/>{en?"New task":"Nueva tarea"}</Button></DialogTrigger><DialogContent closeLabel={en?"Close":"Cerrar"}><form onSubmit={event=>{event.preventDefault();if(!title.trim())return;setTasks(prev=>[...prev,{id:Math.max(...prev.map(t=>t.id))+1,es:title.trim(),en:title.trim(),done:false}]);setTitle("");setOpen(false);toast({title:en?"Task added":"Tarea añadida",description:en?"This preview keeps changes in memory.":"La vista previa conserva los cambios en memoria.",status:"success"});}}><DialogHeader><DialogTitle>{en?"A little closer":"Un paso más cerca"}</DialogTitle><DialogDescription>{en?"Add a task to this local preview.":"Añade una tarea a esta vista previa local."}</DialogDescription></DialogHeader><div className="px-5 py-5"><Field label={en?"Task name":"Nombre de la tarea"} required>{props=><Input {...props} value={title} onChange={event=>setTitle(event.target.value)} placeholder={en?"What comes next?":"¿Qué sigue?"} autoFocus/>}</Field></div><DialogFooter><Button type="button" variant="outline" onClick={()=>setOpen(false)}>{en?"Cancel":"Cancelar"}</Button><Button type="submit" disabled={!title.trim()}>{en?"Add task":"Añadir tarea"}</Button></DialogFooter></form></DialogContent></Dialog>
    </div>
  </section>;
}
