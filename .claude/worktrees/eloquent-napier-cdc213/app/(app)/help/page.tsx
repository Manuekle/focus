import "../product.css";
import { connection } from "next/server";
import { getSupportBookingUrl } from "@/lib/help-booking";
import HelpClient from "./_components/help-client";

export default async function HelpPage() {
  // The optional scheduling link is supplied by the running installation,
  // so read it per request rather than baking the build machine's env into it.
  await connection();
  const bookingUrl = getSupportBookingUrl(process.env.SUPPORT_BOOKING_URL);
  return <HelpClient bookingUrl={bookingUrl} />;
}
