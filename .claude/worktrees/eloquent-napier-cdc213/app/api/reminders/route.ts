import { NextResponse } from "next/server";
import { listReminders, listReminderActivity, deleteReminder } from "@/lib/business-store";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";

// GET /api/reminders — list all reminders
// DELETE /api/reminders?id=xxx — delete a reminder

export const GET = withApiErrors(async function GET() {
  const [reminders, activity] = await Promise.all([listReminders(), listReminderActivity()]);
  // Keyed like every sibling route (`{ automations }`, `{ agents }`, …) so
  // clients can read them all the same way.
  return NextResponse.json({ reminders, activity });
});

export const DELETE = withApiErrors(async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return missingField("id");
  }
  const deleted = await deleteReminder(id);
  if (!deleted) {
    return apiError("not_found");
  }
  return NextResponse.json({ success: true });
});
