"use client";

// The last line of defence: a throw in the root layout itself, where the
// locale and theme providers never mounted. Next replaces the whole document
// here, so this file owns its own <html>/<body> — and it cannot call `useT`.
//
// Hence the two sentences inline. Reading the stored locale directly is the
// only way this screen still speaks the person's language when everything
// above it is gone.

import { useEffect, useState } from "react";

const COPY = {
  es: {
    title: "Lo sentimos, la app no está disponible en este momento",
    description: "Tuvimos un problema inesperado. Recargá para volver a intentarlo.",
    reload: "Recargar",
    home: "Ir al inicio",
  },
  en: {
    title: "Sorry, the app isn't available right now",
    description: "Something unexpected broke. Reload to try again.",
    reload: "Reload",
    home: "Go home",
  },
} as const;

function storedLocale(): "es" | "en" {
  try {
    const stored = localStorage.getItem("oruka-locale");
    if (stored === "es" || stored === "en") return stored;
    return navigator.language.split("-")[0] === "en" ? "en" : "es";
  } catch {
    return "es";
  }
}

export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  // Server and client must agree on the first paint, so the locale is read
  // after mount rather than during render.
  const [locale, setLocale] = useState<"es" | "en">("es");

  useEffect(() => {
    setLocale(storedLocale());
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  const copy = COPY[locale];

  return (
    <html lang={locale}>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "24px",
          padding: "0 16px",
          textAlign: "center",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          background: "#fff",
          color: "#111",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "20px", fontWeight: 500, letterSpacing: "-0.02em", margin: 0 }}>{copy.title}</h1>
          <p style={{ fontSize: "14px", lineHeight: 1.6, opacity: 0.65, margin: 0 }}>
            {copy.description}
          </p>
          {/* The digest is the only thread back to the server log — useful to
              paste into a support message, useless as the headline. */}
          {error.digest ? (
            <p style={{ fontSize: "12px", opacity: 0.4, margin: 0, fontFamily: "ui-monospace, monospace" }}>
              {error.digest}
            </p>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={reset}
            style={{
              height: "36px",
              padding: "0 16px",
              borderRadius: "8px",
              border: "none",
              background: "#111",
              color: "#fff",
              fontSize: "14px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {copy.reload}
          </button>
          {/* A real navigation, not next/link: this component replaces the
              root layout when the root layout itself threw, so the router
              context a <Link> needs is exactly what is not there. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              height: "36px",
              padding: "0 16px",
              borderRadius: "8px",
              border: "1px solid rgba(0,0,0,0.12)",
              color: "inherit",
              textDecoration: "none",
              fontSize: "14px",
              fontWeight: 500,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            {copy.home}
          </a>
        </div>
      </body>
    </html>
  );
}
