import "../../product.css";

/**
 * `/crm/leads` and `/leads` were two copies of the same screen, drifting: only
 * the `/leads` one had a delete action, and only that one is linked from the
 * sidebar. This route keeps working — it is a URL people may have kept — but
 * renders the one implementation rather than a second copy of it.
 */
export { default } from "../../leads/page";
