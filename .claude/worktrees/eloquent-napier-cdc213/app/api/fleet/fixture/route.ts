import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { loadDemoFixture } from "@/lib/demo-fixture";
import { hostedTenant, isFleetRequest } from "@/lib/hosted";
import { isTestTenant } from "@/lib/tenant-config";

// /api/fleet/fixture — load the demo business (Optimed, mocks/optimed.ts) into
// the operator's test tenant, so prueba.oruka.si shows the same clinic as
// `pnpm dev:mock` on localhost.
//
//   POST   replace this tenant's business records, knowledge base and profile
//          with the fixture; `200 {business, contacts, deals, agents, …}`.
//
// Destructive by design, so it is fenced twice: the fleet token (404 for
// anyone else and on self-hosted installs), and the tenant's own runtime
// configuration, where the fleet marks its test tenant `test: true`
// (lib/tenant-config.ts). A customer's tenant answers 409 whatever the token
// says. Accounts, credentials and connections are never touched.
// Contract: docs/hosted-fleet-contract.md.

export const POST = withApiErrors(async function POST(request: NextRequest) {
  if (!isFleetRequest(request)) return apiError("not_found");
  if (!(await isTestTenant())) {
    return apiError("conflict", { message: "Only the fleet's test tenant accepts the demo fixture." });
  }
  const summary = await loadDemoFixture();
  console.log(JSON.stringify({ event: "fleet.fixture.loaded", tenantId: hostedTenant()?.id ?? null, ...summary }));
  return NextResponse.json(summary);
});
