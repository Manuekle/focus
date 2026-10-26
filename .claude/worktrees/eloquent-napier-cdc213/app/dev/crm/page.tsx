// Render the real CRM under the development-only gate for isolated browser QA.
// Tests intercept its API requests; production access is blocked by dev/layout.
export { default } from "@/app/(app)/crm/page";
