"use client";
import { useState } from "react";
import { Button } from "@focus/ui/ui/button";
import { Field } from "@focus/ui/ui/field";
import { Input } from "@focus/ui/ui/input";
import { Switch } from "@focus/ui/ui/switch";
import { Card, CardHeader, CardTitle, CardDescription, CardBody } from "@focus/ui/patterns/dashboard-card";
import { useToast } from "@focus/ui/provider";

/** Mount inside FocusProvider. onSave supplies your application's persistence. */
export function ProjectSettings({initialName="",onSave}: {readonly initialName?:string;readonly onSave:(data:{name:string;notifications:boolean})=>Promise<void>}) {
 const [name,setName]=useState(initialName);const [notifications,setNotifications]=useState(true);
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");const {toast}=useToast();
 return <Card><CardHeader><CardTitle>Ajustes del proyecto</CardTitle><CardDescription>Personaliza el espacio compartido.</CardDescription></CardHeader><CardBody>
   <form className="space-y-5" onSubmit={async event=>{
     event.preventDefault();if(busy)return;
     if(!name.trim()){setError("Escribe un nombre para el proyecto.");return;}
     setError("");setBusy(true);
     try{await onSave({name:name.trim(),notifications});toast({title:"Cambios guardados",status:"success"});}
     catch{toast({title:"No se pudieron guardar los cambios",description:"Revisa la conexión y vuelve a intentarlo.",status:"error"});}
     finally{setBusy(false);}
   }}>
     <Field label="Nombre del proyecto" hint="Lo verá todo el equipo." error={error||undefined} required disabled={busy}>{props=><Input {...props} value={name} onChange={e=>{setName(e.target.value);setError("");}} autoComplete="off"/>}</Field>
     <div className="flex items-start justify-between gap-6"><div><p className="text-sm font-medium">Notificaciones</p><p className="mt-1 text-xs text-muted-foreground">Recibe avisos de actividad del proyecto.</p></div><Switch checked={notifications} onCheckedChange={setNotifications} disabled={busy} label="Notificaciones del proyecto"/></div>
     <Button type="submit" disabled={busy} aria-busy={busy}>{busy?"Guardando…":"Guardar cambios"}</Button>
   </form>
 </CardBody></Card>;
}
