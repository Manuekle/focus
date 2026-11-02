# Deploying Focus on Railway

## Why Railway

Railway keeps the current architecture intact: one container with Next.js, FFmpeg/FFprobe, Sharp, background AI jobs and files on a volume. The generation counter uses SQLite on that volume, so no external database service is needed.

| Platform | Fit for this version |
| --- | --- |
| **Railway (recommended)** | Docker, a long-running process, a persistent volume and an HTTPS domain. The configuration is in this repository. |
| Render | A valid alternative with a paid Docker service and a persistent disk. The disk also forces a single instance. |
| Vercel | Needs storage and processing to be split out: Focus accepts 150 MB uploads while Vercel Functions limit a request body to 4.5 MB, and in-memory jobs and local files are not shared between functions. It can host the frontend if the architecture changes. |

Official sources: [Vercel Functions limits](https://vercel.com/docs/functions/limitations), [Railway volumes](https://docs.railway.com/volumes), [Render disks](https://render.com/docs/disks).

## Demo profile on the trial plan

The demo profile is **a 500 MB volume at `/data`, 1 vCPU, up to 1 GiB of RAM and one active job at a time**. Videos accept **15 seconds and 10 MB**; images accept **5 MB**. The 5 GB of the Hobby plan is a later option with more headroom, not a demonstrated minimum for Flipbook.

The demo sets `FOCUS_MAX_DATA_MB=350` and `FOCUS_MIN_FREE_MB=100`. The volume is checked before accepting uploads and AI work, and before writing images, frames and export files. Binary writes are serialized and encoders are interrupted if they reach the threshold. The margin protects temporary files between checks; it is an application control, not a filesystem quota. When it is reached the API answers `storage_full` (507) and keeps existing files. Saved characters and projects are never deleted automatically. The normal cleanup of expired temporary files still runs. `/api/health` shows usage, the limit and the space left for new media.

`FOCUS_PUBLIC_URL=https://<your-domain>` also defines the allowed origin for changing characters. The comparison uses the public HTTPS URL even when Next receives an internal HTTP one. This does not require enabling `FOCUS_TRUST_PROXY` or trusting arbitrary IP headers.

The file count skips `lost+found` at the volume root: it is a filesystem recovery folder that Railway keeps protected. The reserve is computed from the real free space of the whole volume, including what that folder occupies; its permissions are not changed.

`railway.json` defines:

- A build with the existing `Dockerfile` (Next.js standalone + FFmpeg/FFprobe).
- One instance, with no sleep on inactivity. Jobs and locks live in a single process.
- A required volume at `/data`. The file demands the mount; the volume itself is created in Railway.
- Health checks on `/api/health` with 120 seconds to start.
- Restart on failure, up to five attempts; no overlap between releases.
- Resource ceilings of 1 vCPU and 1 GiB of RAM. They are consumption limits, not reservations or a spending cap.

`deploy/railway.env.example` holds the service variables, without secrets. It enables Flipbook and keeps Time Freeze disabled. The two feature flags and the upload limits are compiled in: set them **before** the first deploy and rebuild to change them. Railway passes variables declared as `ARG` to the Docker build; the Dockerfile declares no arguments for secrets.

Railway mounts the volume as root. `RAILWAY_RUN_UID=0` lets `deploy/docker-entrypoint.sh` change the owner of `/data`; it then runs Next.js as `node` (UID 1000). The server and FFmpeg do not stay root. With plain Docker the image still uses `USER node`.

The Docker healthcheck uses `PORT`, including when Railway assigns it dynamically. Do not override the Start Command: use the image's `ENTRYPOINT` and `CMD`.

`FOCUS_PROVIDER_CONNECTIVITY_CHECK=1` queries, at startup and as the `node` user, the Meta Model API catalog with the configured key and the Graph API without credentials. It logs the HTTP status, the available models, a hashed key identifier and access errors; it never logs the key, sends prompts or runs models. The catalog must answer 200 with a valid key; Graph may answer 400 because it carries no token. The check does not block startup if the network is restricted. It can be turned off once verified.

An HTTP 200 with `models: []` does not confirm that the account can generate. The diagnostic shows `missingModels` and `ready`; check for `ready: true`. Before each new generation in production the server verifies the required models against the authenticated catalog (successes are cached for 60 seconds). If access is missing it refuses the start without spending a generation. Provider request errors log the step, HTTP status, code and request id, never prompts or keys.

## Generation limit

`FOCUS_FREE_EDITS=3` sets a total limit per user, also after signing in. An explicit request for an animation, character version, video edit or redraw uses one turn; the initial frames still pending in an animation that has already started, and the retry of its preparation, are part of that same turn. Automatic previews do not use turns. The limits on drawings per animation, concurrency, storage and requests per hour still apply.

Local development with `pnpm dev` (`NODE_ENV=development`) neither applies nor deducts the generation limit; the session returns `quota: null` and shows no exhaustion notice. Stored counters stay intact. The exception depends on the server environment, never on the host or on client-sent headers: production keeps its limit even if a request claims `localhost`.

The counter is stored at `/data/quota/generations.sqlite`, with transactions that prevent spending the last turn twice. Accounts are identified by their authenticated id regardless of IP; visitors keep cookie-plus-IP control. An account's first visit absorbs that browser's anonymous usage, and signing out does not give turns back. Earlier JSON counters are imported without resetting their usage. Historical usage of accounts that used to be unlimited is not reconstructed: they receive the allowance on their first visit after the update.

When someone tries another generation with a zero balance, "No generations left" appears, without promising that signing in raises the limit. Viewing projects, restoring versions and exporting remain available. The third animation may finish its initial drawings even if starting it used the last turn. Rejections from preliminary checks (including model access) are not deducted; an accepted operation spends the turn even if it fails after starting. Turns whose consumption at the provider is uncertain are not restored automatically.

Back up the whole volume or use SQLite's backup API for the counter; copying only the SQLite file while writes happen is not a consistent copy. Keep a single replica and the Node 24 runtime from the Dockerfile. When scaling to several instances with separate storage, migrate these counters to a shared database before deploying.

## Setting up the account and service

1. Connect the Railway integration or sign in with `pnpm dlx @railway/cli login`.
2. Create a `focus` project and an empty `focus` service in the chosen workspace. For a new project through the CLI:

   ```sh
   pnpm dlx @railway/cli init --name focus
   pnpm dlx @railway/cli add --service focus
   ```

   If the project already exists, use `pnpm dlx @railway/cli link` and select the project and service.

3. Attach a persistent volume to the service, mounted at `/data`; set it to **500 MB** for this demo. The volume and its size are configured in Railway, not in `railway.json`.

   ```sh
   pnpm dlx @railway/cli volume add --service focus --mount-path /data
   ```

   Check the size in the volume settings. Backups are enabled separately there.

4. In **Variables / Raw Editor**, paste `deploy/railway.env.example` and fill in:

   - `MODEL_API_KEY`: a production Meta Model API key.
   - `FOCUS_SESSION_SECRET`: a random value of 32+ characters. Generate one with `openssl rand -base64 48` and store it only as a secret.
   - `FOCUS_ADMIN_TOKEN`: another random secret, used to query `/api/usage` and to unlock `/settings`.
   - `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`: needed to sign in and save projects. Signing in does not reset the generation limit. Keep `FOCUS_AUTH_SIMULATED=0`.

   Do not paste secrets into Git, versioned configuration files, build arguments or screenshots. The local development keys are not needed.

5. Make the first deploy from the current checkout:

   ```sh
   pnpm dlx @railway/cli up --service focus --detach
   ```

   `.railwayignore` excludes secrets, caches and local media. This method includes files that are not in Git yet, so review and publish your changes to the selected branch before turning on GitHub autodeploy.

6. Generate a public HTTPS domain for the service:

   ```sh
   pnpm dlx @railway/cli domain --service focus
   ```

   Check that `FOCUS_PUBLIC_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}` resolves to the assigned domain. With a custom domain, replace it with that HTTPS origin and update Facebook.

7. In the Meta app, register `https://<service-domain>/api/auth/facebook/callback` as a **Valid OAuth Redirect URI**, and register the `/privacy` and `/data-deletion` pages. See [FACEBOOK_LOGIN.md](FACEBOOK_LOGIN.md) for the fields and the access status. This Facebook configuration is not created automatically when you publish to Railway.

8. Check `/api/health`, `/editor` and `/flipbook`. Health should report `storageWritable: true`, `metaConfigured: true` and `aiEnabled: true`. A 200 alone does not certify that keys or Facebook are configured: `/api/health` mainly checks FFmpeg and storage.

Do not create replicas or extra regions, and do not enable sleep. A deploy or restart interrupts any running job; completed files are kept. Publish between generations to reduce interruptions.

## Costs

The trial spends its available credit until it runs out or the deadline shown on the account passes. It supports a 500 MB volume and up to 1 GB of RAM. **The limited trial restricts outbound connections**: check from the service that HTTPS access to the Meta Model API and Graph API works; connecting and verifying GitHub can enable the full trial. The profile does not start a Hobby subscription.

[Railway Hobby](https://railway.com/pricing) is a later alternative: a minimum of **US$5/month**, with US$5 of usage included and additional usage billed separately. The free plan after the trial reduces the available RAM to 0.5 GB and has a smaller monthly credit, so it is not equivalent to the trial profile. Meta's cost is independent of Railway; the `FOCUS_*` limits control requests and jobs but do not guarantee a monthly amount.

Sources: [trial and network restrictions](https://docs.railway.com/pricing/free-trial), [resources per plan](https://docs.railway.com/pricing/plans).

## Local production test, no AI credits

```sh
docker build \
  --build-arg NEXT_PUBLIC_ENABLE_FLIPBOOK=true \
  --build-arg NEXT_PUBLIC_ENABLE_TEMPORAL_EFFECTS=false \
  --build-arg FOCUS_MAX_VIDEO_DURATION_SECONDS=15 \
  --build-arg FOCUS_MAX_UPLOAD_MB=10 \
  --build-arg FOCUS_MAX_IMAGE_UPLOAD_MB=5 \
  -t focus:railway .
pnpm test:deployment
```

The test uses a new, isolated volume, limits the container to **1 CPU / 1 GiB**, reproduces Railway's permissions, starts on `PORT=8080`, checks that PID 1 is `node`, exercises health, sessions and Flipbook, validates a real upload through FFmpeg and checks that media survives a restart. It records peak memory when cgroups allow it. It disables AI and leaves provider keys empty. It removes only its own containers and volumes and writes `.focus-data/deployment/report.json`. The local volume imposes no disk quota; the 500 MB is configured in Railway.

## Operating notes

- The publication branch is `main`. The service should follow it without pinning a `commitSha`, so the next pushes deploy.
- Keep the privacy pages, the trial configuration and the existing volume across deploys.
- Use the public domain for `FOCUS_PUBLIC_URL` and for the URLs registered with Facebook.
- Verify a release by checking `/api/health` (FFmpeg, FFprobe, writable volume, `metaConfigured`, `aiEnabled`). That confirms configuration, not a real generation or the Facebook sign-in round trip, which should be tested separately.

Further references: [config as code](https://docs.railway.com/config-as-code/reference), [current schema](https://railway.com/railway.schema.json), [Dockerfiles and build args](https://docs.railway.com/builds/dockerfiles), [networking and timeouts](https://docs.railway.com/networking/public-networking/specs-and-limits).
