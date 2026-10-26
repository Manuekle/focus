import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { listChatHistory } from "@/lib/business-store";

export const GET = withApiErrors(async function GET() {
  return NextResponse.json({ chats: await listChatHistory() });
});
