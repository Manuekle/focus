import type { Metadata } from "next";
import { Catalog } from "./_components/catalog";

export const metadata: Metadata = {
  title: "Component catalog — oruka",
  description:
    "Every component in the app with live variants and API docs. Dev only.",
  // Belt and braces: the route 404s outside development, but nothing is lost
  // by saying so to a crawler that somehow reaches a dev server.
  robots: { index: false, follow: false },
};

export default function ComponentsCatalogPage() {
  return <Catalog />;
}
