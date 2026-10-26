"use client";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import es from "./es.json";
import en from "./en.json";
export type Locale = "es" | "en";
type Params = Record<string, string | number>;
type Translate = (key: string, params?: Params, fallback?: string) => string;
type I18n = { locale: Locale; setLocale: (locale: Locale) => void; t: Translate };
const dictionaries: Record<Locale, Record<string,string>> = { es, en };
const Context = createContext<I18n | null>(null);
export function I18nProvider({children, initialLocale = "es", messages = {}}: {children: ReactNode; initialLocale?: Locale; messages?: Partial<Record<Locale, Record<string,string>>>}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const value = useMemo(() => ({locale, setLocale, t: (key: string, params?: Params, fallback?: string) => {
    let text = messages[locale]?.[key] ?? dictionaries[locale][key] ?? dictionaries.es[key] ?? fallback ?? key;
    for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  }}), [locale, messages]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useI18n(): I18n {
 const value = useContext(Context);
 if(!value) throw new Error("Mount FocusProvider before using translated components.");
 return value;
}
export function useT(): Translate { return useI18n().t; }
