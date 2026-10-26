"use client";

import { type RefObject, useEffect, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  AiDrawingIcon,
  AiSearch01Icon,
  Analytics01Icon,
  ChatGptIcon,
  DocumentValidationIcon,
  FileEditIcon,
  Folder01Icon,
  GithubIcon,
  GlobalSearchIcon,
  GoogleDriveIcon,
  Image01Icon,
  NotionIcon,
  PaperclipIcon,
  PencilEdit01Icon,
  SlackIcon,
  AiElementsIcon,
} from "@hugeicons/core-free-icons";
import type { MentionableAgent } from "@/lib/chat-agents";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/provider";
import { ChatDropdown } from "./chat-dropdown";

export type DropdownActionItem = {
  id: string;
  kind: "action" | "agent" | "connector";
  title: string;
  description: string;
  icon: typeof PaperclipIcon;
  badge?: string;
  connected?: boolean;
  promptPrefix?: string;
  agent?: MentionableAgent;
  onExecute?: () => void;
};

export function AgentMentionDropdown({
  open = true,
  anchorRef,
  agents,
  filter,
  selectedIndex,
  onSelectAgent,
  onSelectAction,
  onClose,
  onTriggerFilePicker,
  isEmpty = false,
}: {
  readonly open?: boolean;
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly agents: readonly MentionableAgent[];
  readonly filter: string;
  readonly selectedIndex: number;
  readonly onSelectAgent: (agent: MentionableAgent) => void;
  readonly onSelectAction: (item: DropdownActionItem) => void;
  readonly onClose: () => void;
  readonly onTriggerFilePicker?: () => void;
  readonly isEmpty?: boolean;
}) {
  const t = useT();
  const [connectionsStatus, setConnectionsStatus] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    let isMounted = true;
    void fetch("/api/connections")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted || !data) return;
        const statusMap: Record<string, boolean> = {};

        if (Array.isArray(data.connections)) {
          for (const conn of data.connections) {
            statusMap[conn.id] = conn.status === "connected";
          }
        }
        if (Array.isArray(data.manual)) {
          for (const item of data.manual) {
            statusMap[item.id] = Boolean(item.configured);
          }
        }
        setConnectionsStatus(statusMap);
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [open]);


  // Built-in actions matching user reference
  const baseActions: DropdownActionItem[] = [
    {
      id: "action-files",
      kind: "action",
      title: t("chat.actionFiles"),
      description: t("chat.actionFilesDesc"),
      icon: PaperclipIcon,
      onExecute: onTriggerFilePicker,
    },
    {
      id: "action-library",
      kind: "action",
      title: t("chat.actionLibrary"),
      description: t("chat.actionLibraryDesc"),
      icon: Folder01Icon,
      promptPrefix: t("chat.promptPrefixLibrary"),
    },
    {
      id: "action-image",
      kind: "action",
      title: t("chat.actionImage"),
      description: t("chat.actionImageDesc"),
      icon: Image01Icon,
      promptPrefix: t("chat.promptPrefixImage"),
    },
    {
      id: "action-draw",
      kind: "action",
      title: t("chat.actionDraw"),
      description: t("chat.actionDrawDesc"),
      icon: PencilEdit01Icon,
      promptPrefix: t("chat.promptPrefixDraw"),
    },
    {
      id: "action-web",
      kind: "action",
      title: t("chat.actionWeb"),
      description: t("chat.actionWebDesc"),
      icon: GlobalSearchIcon,
      promptPrefix: t("chat.promptPrefixWeb"),
    },
    {
      id: "action-research",
      kind: "action",
      title: t("chat.actionResearch"),
      description: t("chat.actionResearchDesc"),
      icon: AiSearch01Icon,
      promptPrefix: t("chat.promptPrefixResearch"),
    },
  ];

  // Agents
  const agentActions: DropdownActionItem[] = agents.map((agent) => {
    let icon = AiDrawingIcon;
    if (agent.handle === "analista") icon = Analytics01Icon;
    if (agent.handle === "redactor") icon = FileEditIcon;
    if (agent.handle === "revisor") icon = DocumentValidationIcon;
    if (agent.type === "subagent") icon = AiElementsIcon;

    return {
      id: `agent-${agent.id}`,
      kind: "agent",
      title: `@${agent.handle}`,
      description: agent.description,
      icon,
      badge: agent.name,
      agent,
    };
  });

  // Connectors
  const connectorActions: DropdownActionItem[] = [
    {
      id: "connector-openai",
      kind: "connector",
      title: "OpenAI Platform",
      description: t("connector.openaiDesc"),
      icon: ChatGptIcon,
      connected: Boolean(connectionsStatus.openai),
    },
    {
      id: "connector-github",
      kind: "connector",
      title: "GitHub",
      description: t("connector.githubDesc"),
      icon: GithubIcon,
      connected: Boolean(connectionsStatus.github),
    },
    {
      id: "connector-canva",
      kind: "connector",
      title: "Canva",
      description: t("connector.canvaDesc"),
      icon: AiElementsIcon,
      connected: Boolean(connectionsStatus.canva),
    },
    {
      id: "connector-google",
      kind: "connector",
      title: "Google Drive",
      description: t("connector.googleDesc"),
      icon: GoogleDriveIcon,
      connected: Boolean(connectionsStatus.google),
    },
    {
      id: "connector-slack",
      kind: "connector",
      title: "Slack",
      description: t("connector.slackDesc"),
      icon: SlackIcon,
      connected: Boolean(connectionsStatus.slack),
    },
    {
      id: "connector-notion",
      kind: "connector",
      title: "Notion",
      description: t("connector.notionDesc"),
      icon: NotionIcon,
      connected: Boolean(connectionsStatus.notion),
    },
  ];

  const allItems: DropdownActionItem[] = [
    ...baseActions,
    ...agentActions,
    ...connectorActions,
  ];

  const term = filter.toLowerCase().trim();
  const filtered = allItems.filter((item) => {
    if (!term) return true;
    return (
      item.title.toLowerCase().includes(term) ||
      item.description.toLowerCase().includes(term) ||
      item.badge?.toLowerCase().includes(term)
    );
  });

  const handleItemClick = (item: DropdownActionItem) => {
    if (item.kind === "agent" && item.agent) {
      onSelectAgent(item.agent);
      return;
    }
    if (item.onExecute) {
      item.onExecute();
      onClose();
      return;
    }
    onSelectAction(item);
  };

  return (
    <ChatDropdown
      open={open && filtered.length > 0}
      onClose={onClose}
      anchorRef={anchorRef}
      side={isEmpty ? "bottom" : "top"}
      label={t("chat.callAgent")}
      className="w-(--radix-popover-trigger-width)"
      retainFocus
    >
      <div className="flex min-h-0 max-h-[360px] flex-col">
        <div className="y-fade min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 space-y-0.5 scrollbar-thin scrollbar-thumb-border">
          {filtered.map((item, index) => {
            const isSelected = index === selectedIndex;
            const isConnected = item.connected === true;

            return (
              <div
                key={item.id}
                onClick={() => handleItemClick(item)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleItemClick(item);
                }}
                className={cn(
                  "group flex w-full items-center justify-between gap-3 rounded-[8px] px-3 py-2 text-left text-xs transition-colors cursor-pointer select-none",
                  isSelected
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-card text-foreground group-hover:bg-accent transition-colors">
                    <HugeiconsIcon icon={item.icon} size={15} strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
                    <span className="font-medium text-foreground text-[13px] truncate">
                      {item.title}
                    </span>
                    <span className="text-[11px] text-muted-foreground truncate">
                      {item.description}
                    </span>
                  </div>
                </div>

                {/* Connector Status or Connect Button */}
                {item.kind === "connector" && (
                  <div className="shrink-0 pl-2">
                    {isConnected ? (
                      <span className="pill pill-sm tone-pill tone-success gap-1.5">
                        <span className="size-1.5 rounded-full bg-current" />
                        {t("chat.connected")}
                      </span>
                    ) : (
                      <Link
                        href="/connections"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center rounded-lg border border-border/70 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        {t("chat.connect")}
                      </Link>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="shrink-0 border-t border-border/40 px-4 py-2 text-[11px] text-muted-foreground bg-muted/20">
          {t("chat.searchHint")}
        </div>
      </div>
    </ChatDropdown>
  );
}
