import type { Metadata } from "next";
import { Catalog } from "../../catalog/_components/catalog";

export const metadata: Metadata = { title: "Focus — Design system" };

export default function Page() { return <Catalog />; }
