import { writeFile } from "node:fs/promises";

// Import metadata, never gallery pixels or executable page code.
const origin = "https://ai-pose-gallery.pages.dev/";
const response = await fetch(origin, { redirect: "error", signal: AbortSignal.timeout(20_000) });
if (!response.ok) throw new Error(`Pose catalog returned ${response.status}`);
const chunks = [];
let size = 0;
if (!response.body) throw new Error("Empty pose response");
for await (const chunk of response.body) {
  size += chunk.byteLength;
  if (size > 2 * 1024 * 1024) throw new Error("Pose catalog is too large");
  chunks.push(chunk);
}
const html = Buffer.concat(chunks).toString("utf8");
const match = html.match(/const D=(\[.*?\]);\s*const ANG=/s);
if (!match) throw new Error("Pose metadata was not found");
const rows = JSON.parse(match[1]);
if (!Array.isArray(rows) || !rows.length) throw new Error("Empty pose catalog");
const groups = new Map();
const ids = new Set();
for (const row of rows) {
  const parsed = /^(full_sexy|full_single|upper80v2|pair60)_(P\d{3})_(front|high|low|side|diag)$/.exec(row.id);
  if (!parsed || ids.has(row.id) || row["原寸"] !== `img/${row.id}.png` || row["サムネ"] !== `thumbs/${row.id}.jpg`) throw new Error(`Invalid image metadata: ${row.id}`);
  for (const field of ["ポーズ名", "分類", "系統"]) if (typeof row[field] !== "string" || row[field].length > 160) throw new Error(`Invalid ${field}`);
  ids.add(row.id);
  const [, series, number, angle] = parsed;
  const id = `${series}_${number}`;
  let pose = groups.get(id);
  if (!pose) {
    pose = { id, series, name: row["ポーズ名"], category: row["分類"], subjects: series === "pair60" ? 2 : 1, body: series === "upper80v2" ? "upper" : "full", images: [] };
    groups.set(id, pose);
  }
  if (pose.name !== row["ポーズ名"] || pose.category !== row["分類"] || pose.images.some((image) => image.angle === angle)) throw new Error(`Inconsistent pose: ${id}`);
  pose.images.push({ id: row.id, angle });
}
const catalog = { source: origin, poseCount: groups.size, imageCount: ids.size, poses: [...groups.values()] };
await writeFile(new URL("../server/animation/pose-catalog.json", import.meta.url), `${JSON.stringify(catalog, null, 2)}\n`);
await writeFile(new URL("../shared/pose-ids.json", import.meta.url), `${JSON.stringify([...ids], null, 2)}\n`);
console.log(`Indexed ${catalog.poseCount} poses and ${catalog.imageCount} images; no gallery images copied.`);
