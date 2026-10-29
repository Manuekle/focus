import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// A single, static English card. Render with the landing's actual local fonts
// and grain so previews need neither a browser session nor an image service.
const root = new URL("../", import.meta.url);
const asset = async (path, type) =>
  `data:${type};base64,${(await readFile(new URL(path, root))).toString("base64")}`;
const [porkys, inter, grain, cat] = await Promise.all([
  asset("public/fonts/porkys/Porkys-Regular.woff2", "font/woff2"),
  asset("public/fonts/inter/InterVariable-latin.woff2", "font/woff2"),
  asset("public/textures/grain.svg", "image/svg+xml"),
  asset("public/brand/focus-cat.webp", "image/webp"),
]);

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
  headless: true,
});

try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Focus — Open Graph</title>
  <style>
    @font-face { font-family: Porkys; src: url("${porkys}") format("woff2"); font-weight: 400; }
    @font-face { font-family: Inter; src: url("${inter}") format("woff2"); font-weight: 100 900; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
    body { font-family: Inter, sans-serif; color: #f5f5f5; -webkit-font-smoothing: antialiased; }
    .card { position: relative; isolation: isolate; width: 100%; height: 100%; background: #181818; }
    .card::before, .card::after { content: ""; position: absolute; inset: 0; z-index: -1; }
    .card::before {
      background:
        radial-gradient(ellipse 46% 56% at 48% 26%, #101219 10%, #101219cc 46%, transparent 100%),
        radial-gradient(ellipse 100% 100% at 110% 110%, #160c0b 0%, #26100b 36%, #7d2c12 43%, #d56726 48%, #ddba86 51%, #a2b3c4 54%, #3569ae 59%, #123981 67%, #0c1b3a 80%, transparent 94%),
        radial-gradient(ellipse 60% 58% at 0% 28%, #254e8c 0%, #10264b 50%, transparent 100%);
      opacity: .72;
    }
    .card::after { background: url("${grain}") repeat; background-size: 192px 192px; mix-blend-mode: soft-light; opacity: .38; }
    .light { position: absolute; inset: 0; z-index: -1; background: radial-gradient(ellipse 34% 42% at 50% 0%, #a9bbff1c, transparent 70%), radial-gradient(ellipse 46% 34% at 50% 62%, #2853e914, transparent 72%); }
    header { position: absolute; top: 45px; left: 60px; right: 60px; display: flex; align-items: center; justify-content: space-between; }
    .brand { display: flex; align-items: center; gap: 10px; font: 400 38px/1 Porkys, sans-serif; letter-spacing: -1.5px; }
    .brand img { width: 42px; height: 42px; border: 1px solid #ffffff14; border-radius: 12px; }
    .dot { color: #6385fe; }
    .eyebrow { color: #b5b9c6; font-size: 12px; font-weight: 500; letter-spacing: 2px; }
    main { position: absolute; inset: 162px 60px auto; text-align: center; }
    h1 { margin: 0; font: 400 108px/1.08 Porkys, sans-serif; letter-spacing: -.035em; }
    .white { text-shadow: 0 0 .12em #ffffff40, 0 0 .45em #ffffff1f, 0 0 1em #ffffff0d; }
    .accent { display: inline-block; padding: .1em .18em; margin: -.1em -.18em; color: #6385fe; background: linear-gradient(180deg, #9aafff 0%, #6385fe 48%, #3b68ff 100%); background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 0 .2em #325cfe33) drop-shadow(0 0 .7em #6385fe14); }
    .description { margin: 27px 0 0; color: #bdc1ce; font-size: 20px; line-height: 1.6; letter-spacing: -.02em; }
    footer { position: absolute; bottom: 39px; left: 60px; right: 60px; padding-top: 18px; border-top: 1px solid #ffffff14; display: flex; justify-content: space-between; color: #a6abba; font-size: 12px; letter-spacing: -.01em; }
    .formats { display: flex; gap: 14px; align-items: center; }
    .separator { color: #7c8498; }
  </style>
</head>
<body>
  <div class="card">
    <div class="light"></div>
    <header>
      <div class="brand"><img src="${cat}" alt=""><span>focus<span class="dot">.</span></span></div>
      <span class="eyebrow">A LITTLE MORE LIFE</span>
    </header>
    <main>
      <h1><span class="white">Your drawings.</span><br><span class="accent">In motion.</span></h1>
      <p class="description">Bring your characters to life, one frame at a time.</p>
    </main>
    <footer>
      <span>One drawing. A whole little story.</span>
      <div class="formats"><span>MP4</span><span class="separator">/</span><span>GIF</span><span class="separator">/</span><span>Sprite sheets</span></div>
    </footer>
  </div>
</body>
</html>`);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  const path = fileURLToPath(new URL("public/og.png", root));
  await page.screenshot({ path, type: "png" });
  console.log(`Generated ${path} (1200 × 630, English)`);
} finally {
  await browser.close();
}
