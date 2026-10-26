"use client";

import { useState } from "react";
import { AnimatedNumber, ChartPeriod, ChartSelector, DonutChart, RankedBars, StackedBars, TimeSeries } from "@/app/_components/chart";
import { Card, CardBody, CardHeader, CardSeparator, CardTitle } from "@/app/_components/dashboard-card";

/** Development-only fixture: synthetic values never enter production dashboards. */
export default function ChartsPreview() {
  const [days, setDays] = useState(30);
  const [empty, setEmpty] = useState(false);
  const [fractional, setFractional] = useState(false);
  const [one, setOne] = useState(false);
  const series = Array.from({ length: one ? 1 : days }, (_, i) => {
    const day = new Date(Date.UTC(2026, 8, 10 - days + 1 + i));
    return { key: day.toISOString().slice(0, 10), label: day.toLocaleDateString("es", { day: "numeric", month: "short", timeZone: "UTC" }), value: empty ? 0 : Math.max(3, Math.round(9 + i / Math.max(1, days - 1) * 23 + 6 * Math.sin(i * .7 + 1) + 3 * Math.sin(i * 1.9))) / (fractional ? 1000 : 1) };
  });
  const format = (n: number) => fractional ? `$${n.toFixed(3)}` : Math.round(n).toLocaleString("en-US");
  const channels = ["WhatsApp", "Instagram", "Messenger", "Web", "Email"].slice(0, one ? 1 : 5).map((label, i) => ({ key: label, label, value: empty ? 0 : Math.round([1240, 980, 620, 410, 300][i] * (days / 30) * (.98 + .2 * Math.sin(i * 1.9 + days * .13))), formatted: "", formatValue: (n: number) => Math.round(n).toLocaleString("en-US") }));
  const bands = ["Abiertos", "Esperando respuesta", "Seguimiento", "Cerrados"].map((label) => ({ key: label, label }));
  const columns = ["Meta Ads", "Formulario", "Referidos", "Orgánico"].slice(0, one ? 1 : 4).map((label, i) => ({ key: label, label, values: bands.map((_, j) => empty ? 0 : Math.round((23 + i * 7) * (days / 14) * (.6 + .3 * Math.sin(i * 3.1 + j * 1.7)))) }));
  return <main className="min-h-screen bg-background px-4 py-12">
    <div className="mx-auto max-w-[500px] space-y-10">
      <header><h1 className="font-sans text-lg font-medium">Gráficas de Oruka</h1><p className="mt-2 text-sm text-muted-foreground">Fixture de desarrollo · datos de prueba</p>
        <div className="mt-4 flex flex-wrap gap-4 text-xs"><label><input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} /> Sin actividad</label><label><input type="checkbox" checked={fractional} onChange={(e) => setFractional(e.target.checked)} /> Coste fraccional</label><label><input type="checkbox" checked={one} onChange={(e) => setOne(e.target.checked)} /> Un dato</label></div>
      </header>
      <section aria-label="Actividad">
        <Card><CardHeader><div className="min-w-0 flex-1"><CardTitle>Nuevos contactos</CardTitle><AnimatedNumber className="mt-2 block text-[27px] font-medium" value={series.reduce((sum, point) => sum + point.value, 0)} format={format} /></div><ChartPeriod value={String(days)}>{days} días</ChartPeriod></CardHeader><CardSeparator /><CardBody><TimeSeries data={series} emptyLabel="Sin actividad" formatAxis={fractional ? format : undefined} markers={new Set([series[3]?.key])} formatValue={(point) => <><span className="block text-[11px] text-muted-foreground">{point.label}</span><strong>{format(point.value)} contactos</strong></>} /></CardBody></Card>
      </section>
      <section aria-label="Canales">
        <Card><CardHeader><div><CardTitle>Conversaciones por canal</CardTitle><AnimatedNumber className="mt-2 block text-[31px] font-medium" value={channels.reduce((sum, channel) => sum + channel.value, 0)} /></div></CardHeader><CardSeparator /><CardBody><DonutChart data={channels} emptyLabel="Sin conversaciones" /></CardBody></Card>
      </section>
      <section aria-label="Origen">
        <Card><CardHeader><CardTitle>Contactos por origen</CardTitle></CardHeader><CardSeparator /><CardBody><StackedBars columns={columns} bands={bands} totalLabel="contactos" emptyLabel="Sin contactos" /></CardBody></Card>
      </section>
      <section aria-label="Comparación"><Card><CardHeader><CardTitle>Gasto por campaña</CardTitle></CardHeader><CardSeparator /><CardBody><RankedBars bars={channels.map((channel) => ({ ...channel, value: channel.value / 1000, formatted: `$${(channel.value / 1000).toFixed(3)}`, formatValue: (n) => `$${n.toFixed(3)}` }))} emptyLabel="Sin campañas" /></CardBody></Card></section>
      <div className="sticky bottom-4 z-10"><ChartSelector value={String(days)} label="Periodo" options={[7, 14, 30, 90].map((value) => ({ value: String(value), label: `${value}D` }))} onChange={(value) => setDays(Number(value))} /></div>
    </div>
  </main>;
}
