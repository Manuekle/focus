import { NextResponse, type NextRequest } from "next/server";
import {
  getBusinessIdentity,
  saveBusinessIdentity,
  type BusinessIdentityFields,
} from "@/lib/business-profile-store";
import { apiError, withApiErrors } from "@/lib/api-error";

// GET   /api/business-profile/identity — what the owner typed in by hand
// PATCH /api/business-profile/identity — save any subset of those fields
//
// Separate from the profile route because these two are edited on completely
// different rhythms: the identity is typed once and corrected rarely, the
// profile is re-generated whenever the website changes.

const FIELDS = [
  "name",
  "description",
  "websiteUrl",
  "email",
  "phone",
  "address",
  "hours",
] as const satisfies readonly (keyof BusinessIdentityFields)[];

/** Kept deliberately loose: this is the owner describing their own business,
 *  not a payment form. An empty value clears the field. */
function invalidField(field: (typeof FIELDS)[number], value: string): string | null {
  if (!value) return null;
  if (field === "websiteUrl" && !/^https?:\/\/\S+$/i.test(value)) {
    return "websiteUrl must start with http:// or https://";
  }
  if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "email doesn't look like an address";
  }
  return null;
}

export const GET = withApiErrors(async function GET() {
  return NextResponse.json({ identity: await getBusinessIdentity() });
});

export const PATCH = withApiErrors(async function PATCH(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object") return apiError("invalid_body");

  const input = body as Record<string, unknown>;
  // Built mutably, handed over as the readonly patch the store takes.
  const patch: { -readonly [K in keyof BusinessIdentityFields]?: string } = {};

  for (const field of FIELDS) {
    const value = input[field];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    const problem = invalidField(field, trimmed);
    if (problem) return apiError("invalid_field", { field, message: problem });
    patch[field] = trimmed;
  }

  if (Object.keys(patch).length === 0) return apiError("nothing_to_update");

  return NextResponse.json({ identity: await saveBusinessIdentity(patch) });
});
