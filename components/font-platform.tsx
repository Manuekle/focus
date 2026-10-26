"use client";

import { useLayoutEffect } from "react";

/** Restore the parser's platform flag if React recovered the document after
 * a hydration error. Inline scripts inserted during recovery do not execute. */
export function FontPlatform() {
  useLayoutEffect(() => {
    const browser = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = browser.userAgentData?.platform || browser.platform || "";
    document.documentElement.dataset.fontPlatform = /^(Mac|iPhone|iPad|iPod|iOS)/i.test(platform) ? "apple" : "custom";
  }, []);
  return null;
}
