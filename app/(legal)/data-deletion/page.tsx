import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Delete my data · Focus",
  description: "How to request deletion of your Focus account and the data linked to it.",
};

export default function DataDeletionPage() {
  return (
    <>
      <h1>Delete my Focus data</h1>
      <p>You can request deletion of your Focus account, the Facebook data linked to it, and your saved projects and media.</p>
      <ol>
        <li>Write to <a href="mailto:elustondo129@gmail.com?subject=Delete%20my%20Focus%20data">elustondo129@gmail.com</a> with the subject <strong>Delete my Focus data</strong>.</li>
        <li>Include the name shown on your Focus account and the linked email address, if it has one. If you only want to delete one project or file, say which. Do not send passwords, access codes or identity documents.</li>
        <li>Requests are handled manually after we verify that you own the account. Deletion covers the account data and the projects and media linked to it that match your request.</li>
      </ol>
      <h2>Disconnect Facebook</h2>
      <p>You can also remove Focus from the <strong>Apps and websites</strong> section of your Facebook settings. That revokes the authorization on Facebook, but it does not automatically delete the data Focus already stores. To delete it, use the contact email above.</p>
      <p>After your account is deleted, signing in again may create a new account. Signing out or clearing your browser cookies is not a deletion request either.</p>
      <p>More information in the <Link href="/privacy">Focus privacy policy</Link>.</p>
    </>
  );
}
