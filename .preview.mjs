import { chromium } from "@playwright/test";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360" viewBox="0 0 240 360">
  <rect width="240" height="360" fill="none"/>
  <circle cx="120" cy="92" r="40" fill="#c7d2fe"/>
  <path d="M120 132 L120 240 M70 180 L120 160 L170 180 M120 240 L84 320 M120 240 L156 320" stroke="#c7d2fe" stroke-width="22" stroke-linecap="round" fill="none"/>
</svg>`;

const browser = await chromium.launch({ executablePath: "/Users/manudev/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell" });
const page = await browser.newPage({ viewport: { width: 1512, height: 950 }, deviceScaleFactor: 1 });
page.on("console", (message) => { if (message.type() === "error") console.log("console:", message.text()); });
page.on("pageerror", (error) => console.log("pageerror:", error.message));
await page.route("**/api/rotoscope/runs/**/media*", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg }));
await page.goto("http://127.0.0.1:3200/canvas-preview-test", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: "/private/var/folders/23/fc97r1zx7yq3d55051xhg_ch0000gn/T/opencode/canvas-desktop.png" });

// Open the light table.
await page.getByRole("button", { name: /Light table/i }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: "/private/var/folders/23/fc97r1zx7yq3d55051xhg_ch0000gn/T/opencode/canvas-player.png" });

// Zoom and pan, then look at the result.
await page.getByRole("button", { name: "Zoom in" }).click();
await page.getByRole("button", { name: "Zoom in" }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: "/private/var/folders/23/fc97r1zx7yq3d55051xhg_ch0000gn/T/opencode/canvas-zoom.png" });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await mobile.route("**/api/rotoscope/runs/**/media*", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg }));
await mobile.goto("http://127.0.0.1:3200/canvas-preview-test", { waitUntil: "networkidle" });
await mobile.waitForTimeout(600);
await mobile.screenshot({ path: "/private/var/folders/23/fc97r1zx7yq3d55051xhg_ch0000gn/T/opencode/canvas-mobile.png" });

console.log("done");
await browser.close();
