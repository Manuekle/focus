import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isAdminHost } from "@/lib/admin-host";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const admin = isAdminHost((await headers()).get("host"));
  return {
    id: "/",
    name: admin ? "Oruka Admin" : "Oruka",
    short_name: "Oruka",
    description: "Asistente de IA para tu negocio",
    lang: "es",
    start_url: admin ? "/" : "/chat",
    scope: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#fafafa",
    icons: [
      { src: "/icons/oruka-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/oruka-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/oruka-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
