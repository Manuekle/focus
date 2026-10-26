"use client";

/**
 * The app screens the landing puts on show.
 *
 * They are not screenshots and they are not drawings of the product: each one
 * renders the components the matching page renders, over a fixed demo dataset,
 * and the parts of the page that are interactive are interactive here too.
 * `screen-flow.tsx` goes furthest — it mounts the product's own `FlowCanvas`,
 * so the canvas on the landing is the canvas.
 *
 * One file per screen, and this barrel so the sections keep importing from one
 * place. `screen-chrome.tsx` holds the sidebar and the page frame they share.
 */

export { AdsScreen } from "./screen-ads";
export { ChatScreen } from "./screen-chat";
export { FlowScreen } from "./screen-flow";
export { InboxScreen } from "./screen-inbox";
