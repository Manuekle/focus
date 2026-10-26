import type { Metadata, Viewport } from "next";
import { Workspace } from "./_editor/workspace";

export const metadata: Metadata = {
  title: "Focus — Make anything stand out.",
  description: "Editor de video con IA: sube un clip, describe el cambio y destaca cualquier sujeto.",
};

// Lets the mobile export bar sit above the home indicator (env(safe-area-inset-bottom)).
export const viewport: Viewport = { viewportFit: "cover" };

export default function Page() {
  return <Workspace />;
}
