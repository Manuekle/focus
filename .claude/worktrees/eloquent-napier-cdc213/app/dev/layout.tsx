import "../(app)/product.css";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ProductI18n } from "@/lib/i18n/product-provider";

/**
 * The gate on everything under /dev.
 *
 * These pages exist to look at the app's own building blocks, so they import
 * every component in the repo and mount all of them at once. That is a useful
 * thing on a laptop and a liability on a deployment: it is a route with no
 * product purpose that pulls the whole component graph into a bundle.
 *
 * `notFound()` rather than a redirect, because a 404 is the honest answer —
 * in a production build this route does not exist. The middleware makes the
 * matching decision for the session gate; see `isPublic` there.
 *
 * `force-dynamic` keeps Next from trying to prerender this at build time,
 * where NODE_ENV is already "production" and the gate would 404 the build.
 */
export const dynamic = "force-dynamic";

export default function DevLayout({ children }: { readonly children: ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return <ProductI18n>{children}</ProductI18n>;
}
