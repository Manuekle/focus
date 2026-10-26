"use client";

import { lazy } from "react";

// All parts share a single chunk. Callers mount them only after opening the
// picker, so an idle sidebar does not download or initialize the search engine.
const load = () => import("./command");

/** Starts the download early (hover, focus) so opening never waits on it. */
export const preloadCommand = () => load();
export const CommandDialog = lazy(() => load().then((module) => ({ default: module.CommandDialog })));
export const CommandEmpty = lazy(() => load().then((module) => ({ default: module.CommandEmpty })));
export const CommandGroup = lazy(() => load().then((module) => ({ default: module.CommandGroup })));
export const CommandInput = lazy(() => load().then((module) => ({ default: module.CommandInput })));
export const CommandItem = lazy(() => load().then((module) => ({ default: module.CommandItem })));
export const CommandList = lazy(() => load().then((module) => ({ default: module.CommandList })));
