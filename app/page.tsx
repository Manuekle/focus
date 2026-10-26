import type { Metadata } from "next";
import { Workspace } from "./_editor/workspace";

export const metadata: Metadata = {
  title: "Focus — Make anything stand out.",
  description: "Editor de video con IA: sube un clip, describe el cambio y destaca cualquier sujeto.",
};

export default function Page() {
  return <Workspace />;
}
