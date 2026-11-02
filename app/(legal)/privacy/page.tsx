import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy · Focus",
  description: "How Focus uses your account data, your files and your instructions.",
};

export default function PrivacyPage() {
  return (
    <>
      <h1>Focus privacy policy</h1>
      <p className="text-sm text-muted-foreground">Last updated: November 1, 2026.</p>
      <p>Focus lets you edit clips and create animations from images and instructions. To ask how your data is handled, write to <a href="mailto:elustondo129@gmail.com">elustondo129@gmail.com</a>, the contact for the person who runs this service.</p>

      <h2>Data we use</h2>
      <ul>
        <li><strong>Facebook account:</strong> when you sign in we receive your Facebook ID, name, profile picture and email address, if Facebook provides it. We use them to identify your account and link your projects to it. We do not ask for access to your posts, friends list or Facebook photo and video library.</li>
        <li><strong>Content you provide:</strong> images, clips, instructions, projects and generated results, used to carry out the features you request.</li>
        <li><strong>Technical data:</strong> session and visitor identifiers, job status and usage data needed to apply limits, keep the service running and fix errors.</li>
      </ul>

      <h2>Processing and providers</h2>
      <p>Focus uses Railway to host the service and store its files. When you request an artificial-intelligence feature, the instructions and the images or clips it needs are sent to the Meta Model API for analysis, generation or segmentation. Those providers process the information under their own terms and policies.</p>
      <p>Your Facebook account data is not automatically included in requests to the AI models. Avoid putting sensitive information in the files or instructions you send for processing.</p>

      <h2>Retention</h2>
      <p>Temporary media that does not belong to a saved project may be removed by the automatic cleanup after 24 hours. Account data and saved projects are kept so you can come back to them, or until you ask for them to be deleted. Keep a copy of any file you want to hold on to.</p>

      <h2>Cookies and browser storage</h2>
      <p>We use cookies to keep you signed in, to verify the return from Facebook and to count free edits. A session can last up to 30 days and the visitor identifier up to one year. Your browser may also keep instructions and editor state locally. You can sign out and clear the site&apos;s data from your browser; neither action deletes your account or the files saved on the server by itself.</p>

      <h2>Access, correct or delete your data</h2>
      <p>You can request information, corrections or deletion of your data by writing to <a href="mailto:elustondo129@gmail.com">elustondo129@gmail.com</a>. We may ask for information that lets us verify the account is yours, but never your Facebook password. See the <Link href="/data-deletion">data deletion instructions</Link>.</p>
    </>
  );
}
