import { createHiggsfieldClient } from "@higgsfield/client/v2";

// Higgsfield smoke test: one Seedance 2.5 text-to-video request through the
// official SDK. Billable. Reads HF_CREDENTIALS ("key-id:key-secret") from
// .env.local at runtime and never prints it.
//
//   pnpm higgsfield:example

const credentials = process.env.HF_CREDENTIALS;
if (!credentials?.includes(":")) {
  console.error("HF_CREDENTIALS is missing: add HF_CREDENTIALS=key-id:key-secret to .env.local");
  process.exit(1);
}

const client = createHiggsfieldClient({ credentials, maxPollTime: 15 * 60_000 });
try {
  const result = await client.subscribe("bytedance/seedance-2.5/text-to-video", {
    input: { prompt: "A cinematic scene at sunset", duration: 5, resolution: "720p", aspect_ratio: "16:9" },
    withPolling: true,
  });
  const status = String(result.status);
  if (status === "completed" && result.video?.url) {
    console.log(`completed (request ${result.request_id})\n${result.video.url}`);
  } else {
    // failed, nsfw (moderated), canceled or still running: never reported as success.
    console.error(`not completed: status ${status} (request ${result.request_id})`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Higgsfield request failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
