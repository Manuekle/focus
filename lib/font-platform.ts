/** Runs before first paint without making the root layout depend on request
 * headers. iPads in desktop mode report MacIntel; Chromium exposes OS names
 * through userAgentData. No platform information is sent to the server. */
export const FONT_PLATFORM_SCRIPT = `
(function() {
  try {
    var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    document.documentElement.dataset.fontPlatform = /^(Mac|iPhone|iPad|iPod|iOS)/i.test(platform) ? 'apple' : 'custom';
  } catch (e) {}
})();
`;

export type InterfaceFontPath = "/fonts/inter/InterVariable-latin.woff2";

/** The URL is a fixed local font asset, never user input. A parser-executed
 * hint loads the Inter variable face on every platform. */
export function interfaceFontPreloadScript(href: InterfaceFontPath): string {
  return `(function(){{var link=document.createElement('link');link.rel='preload';link.as='font';link.type='font/woff2';link.crossOrigin='anonymous';link.href=${JSON.stringify(href)};document.head.appendChild(link);}})();`;
}
