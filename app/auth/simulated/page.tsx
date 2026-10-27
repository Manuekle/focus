import type { Metadata } from "next";
import { SimulatedSignIn } from "./simulated-sign-in";

export const metadata: Metadata = { title: "Sign in · Focus", robots: { index: false } };

type Props = { searchParams: Promise<{ state?: string }> };

/** Local stand-in for the Facebook Login dialog, until a Meta app is configured. */
export default async function Page({ searchParams }: Props) {
  const { state } = await searchParams;
  return <SimulatedSignIn state={typeof state === "string" ? state : ""} />;
}
