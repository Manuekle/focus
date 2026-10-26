import type { ReactNode } from "react";
import { AgentNavigationProvider } from "./_components/agent-navigation";

export default function AgentsLayout({ children }: { readonly children: ReactNode }) {
  return <AgentNavigationProvider>{children}</AgentNavigationProvider>;
}
