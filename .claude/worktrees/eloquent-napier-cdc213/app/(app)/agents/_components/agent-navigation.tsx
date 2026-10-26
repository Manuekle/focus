"use client";

import { createContext, useCallback, useContext, useMemo, useRef, ViewTransition, type ReactNode } from "react";
import { useBrowserStorageScope } from "@/lib/browser-storage-scope";
import type { Agent } from "@/lib/types";
import { getAgentTemplate } from "@/lib/agent-templates";
import { HugeiconsIcon } from "@/components/icons/icon";
import { AiImagineIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import "./agent-navigation.css";

type ReturnPoint = { search: string; scrollTop: number; agentId: string; action: "title" | "open" };
type Snapshot = { agents: Agent[] | null; returnPoint: ReturnPoint | null };
type Navigation = {
  scope: string;
  read: () => Snapshot;
  rememberAgents: (agents: Agent[]) => void;
  rememberAgent: (agent: Agent) => void;
  rememberReturn: (point: ReturnPoint) => void;
  discardAgents: () => void;
};
const AgentNavigation = createContext<Navigation | null>(null);

/** A route-local handoff, never browser storage or a module-global cache.
 * A new account/business gets a fresh provider; leaving /agents discards it.
 * These records only seed the returning list and a read-only loading header.
 * The editor always loads its authoritative draft from /api/agents. */
export function AgentNavigationProvider({ children }: { readonly children: ReactNode }) {
  const scope = useBrowserStorageScope();
  return <ScopedNavigation key={scope} scope={scope}>{children}</ScopedNavigation>;
}

function ScopedNavigation({ scope, children }: { scope: string; children: ReactNode }) {
  const snapshot = useRef<Snapshot>({ agents: null, returnPoint: null });
  const read = useCallback(() => snapshot.current, []);
  const rememberAgents = useCallback((agents: Agent[]) => { snapshot.current = { ...snapshot.current, agents }; }, []);
  const rememberAgent = useCallback((agent: Agent) => {
    snapshot.current = { ...snapshot.current, agents: snapshot.current.agents?.map((item) => item.id === agent.id ? agent : item) ?? null };
  }, []);
  const rememberReturn = useCallback((returnPoint: ReturnPoint) => { snapshot.current = { ...snapshot.current, returnPoint }; }, []);
  const discardAgents = useCallback(() => { snapshot.current = { ...snapshot.current, agents: null }; }, []);
  const value = useMemo(() => ({ scope, read, rememberAgents, rememberAgent, rememberReturn, discardAgents }),
    [scope, read, rememberAgents, rememberAgent, rememberReturn, discardAgents]);
  return <AgentNavigation value={value}>{children}</AgentNavigation>;
}

export function useAgentNavigation(): Navigation {
  const navigation = useContext(AgentNavigation);
  if (!navigation) throw new Error("Agent navigation requires AgentsLayout");
  return navigation;
}

// Hex encodes every code point, including separators, so arbitrary real IDs
// remain valid CSS identifiers without collisions introduced by sanitizing.
function identifier(value: string): string {
  return Array.from(value, (char) => char.codePointAt(0)!.toString(16)).join("-");
}

export function agentTransitionName(scope: string, id: string, part: "avatar" | "title"): string {
  return `oruka-agent-${identifier(scope)}--${identifier(id)}-${part}`;
}

export function agentListScroller(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;
  while (parent) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent;
    parent = parent.parentElement;
  }
  return document.scrollingElement as HTMLElement | null;
}

export function AgentSharedTitle({ id, children }: { id: string; children: ReactNode }) {
  const { scope } = useAgentNavigation();
  return <ViewTransition name={agentTransitionName(scope, id, "title")} share={{ "oruka-agent": "agent-title", default: "none" }} default="none">{children}</ViewTransition>;
}

export function AgentSharedAvatar({ agent, compact = false }: {
  agent: Pick<Agent, "id" | "iconKey" | "status">;
  compact?: boolean;
}) {
  const { scope } = useAgentNavigation();
  const template = getAgentTemplate(agent.iconKey);
  return (
    <ViewTransition name={agentTransitionName(scope, agent.id, "avatar")} share={{ "oruka-agent": "agent-avatar", default: "none" }} default="none">
      <div aria-hidden="true" className={cn(
        "flex shrink-0 items-center justify-center rounded-xl shadow-[var(--shadow-inset)]",
        compact ? "size-8" : "size-10",
        template?.accent ?? (agent.status === "active" ? "bg-muted text-foreground" : "bg-muted/50 text-muted-foreground"),
      )}>
        <HugeiconsIcon icon={template?.icon ?? AiImagineIcon} size={compact ? 16 : 20} strokeWidth={1.75} />
      </div>
    </ViewTransition>
  );
}
