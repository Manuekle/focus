import {
  deleteChat,
  deleteContact,
  listChats,
  listContacts,
  moveContact,
  setContactStatus,
  toggleChatPin,
  upsertChat,
  upsertContact,
} from "@/lib/business-store";
import type { ChatSummary, Contact, ContactStatus } from "@/lib/types";
import { type NextRequest, NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";

export const GET = withApiErrors(async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status");
  const page = Math.max(1, parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50));

  const [allContacts, chats] = await Promise.all([listContacts(), listChats()]);
  const filtered =
    status === "waiting_human" || status === "followup_due" || status === "open" || status === "closed"
      ? allContacts.filter((c) => c.status === status)
      : allContacts;

  const total = filtered.length;
  const start = (page - 1) * limit;
  const contacts = filtered.slice(start, start + limit);

  return NextResponse.json({ contacts, chats, total, page, limit });
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object") {
    return apiError("invalid_body");
  }
  const input = body as { contact?: Partial<Contact>; chat?: Omit<ChatSummary, "id"> & { id?: string } };
  let contact: Contact | undefined;
  let chats: ChatSummary[] | undefined;
  if (input.contact) contact = await upsertContact(input.contact);
  if (input.chat) chats = await upsertChat(input.chat);
  return NextResponse.json({
    ok: true,
    contact,
    chats: chats ?? (await listChats()),
    contacts: await listContacts(),
  });
});

export const PUT = withApiErrors(async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object") {
    return apiError("invalid_body");
  }
  const input = body as {
    contactId?: string;
    status?: ContactStatus;
    /** Slot inside the destination column, counted within that column only.
     *  Sent by the CRM board when a card is dropped between two others. */
    index?: number;
    name?: string;
    notes?: string;
    attributes?: Record<string, string>;
    chatId?: string;
    togglePin?: boolean;
  };
  if (input.contactId) {
    const index =
      typeof input.index === "number" && Number.isInteger(input.index) && input.index >= 0
        ? input.index
        : undefined;
    if (input.status && index !== undefined) {
      await moveContact(input.contactId, input.status, index);
    } else if (input.status) {
      await setContactStatus(input.contactId, input.status);
    }
    if (input.name || input.notes || input.attributes) {
      await upsertContact({
        id: input.contactId,
        name: input.name,
        notes: input.notes,
        attributes: input.attributes,
      });
    }
    const contacts = await listContacts();
    return NextResponse.json({ contacts });
  }
  if (input.chatId && input.togglePin) {
    const chats = await toggleChatPin(input.chatId);
    return NextResponse.json({ chats });
  }
  return apiError("nothing_to_update");
});

export const DELETE = withApiErrors(async function DELETE(request: NextRequest) {
  const chatId = request.nextUrl.searchParams.get("chatId");
  const contactId = request.nextUrl.searchParams.get("contactId");
  if (chatId) {
    const chats = await deleteChat(chatId);
    return NextResponse.json({ chats });
  }
  if (contactId) {
    const contacts = await deleteContact(contactId);
    return NextResponse.json({ contacts });
  }
  return missingField("chatId or contactId");
});
