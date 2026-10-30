import type { Metadata } from "next";
import { SettingsStudio } from "./settings-studio";

export const metadata: Metadata = {
  title: "Settings · Focus",
  description: "Environment variables for this Focus server, saved on its own disk.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <SettingsStudio />;
}
