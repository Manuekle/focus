import { NextResponse, type NextRequest } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { getBusinessIdentity, saveBookingPolicy } from "@/lib/business-profile-store";
import { BookingPolicyError } from "@/lib/action-runtime/booking-policy";

export const GET = withApiErrors(async function GET() {
  return NextResponse.json({ policy: (await getBusinessIdentity()).bookingPolicy });
});

export const PUT = withApiErrors(async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  try {
    return NextResponse.json({ policy: await saveBookingPolicy(body) });
  } catch (error) {
    if (error instanceof BookingPolicyError) {
      return apiError("invalid_field", { field: "policy", message: error.message });
    }
    throw error;
  }
});
