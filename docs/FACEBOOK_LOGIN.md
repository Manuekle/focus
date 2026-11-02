# Facebook Login

Focus signs people in with Facebook. Locally the flow is simulated (`FOCUS_AUTH_SIMULATED=1`); in production it uses a real Meta app.

## App and credentials

Use a Meta app of type **Consumer**. In its dashboard you need three areas: *Settings → Basic*, *Facebook Login → Settings* (OAuth) and *App Review → Permissions and features*.

Set these variables on the service (never in Git or in documentation):

| Variable | Purpose |
| --- | --- |
| `FACEBOOK_APP_ID` | The app id |
| `FACEBOOK_APP_SECRET` | The app secret (server only) |
| `FACEBOOK_GRAPH_VERSION` | The Graph API version the app shows for its calls and roles |
| `FOCUS_SESSION_SECRET` | Random secret that signs session cookies |
| `FOCUS_AUTH_SIMULATED` | Keep `0` in production |

The server uses the OAuth authorization-code flow and requests only `public_profile,email`. The sign-in dialog also tells people that the email is optional. The Facebook password never passes through Focus. Without credentials, the production sign-in returns 503 and does not turn on the simulation.

## Service URLs

`FOCUS_PUBLIC_URL` and the Meta fields must use the same HTTPS origin. When you change domain, remove the old callbacks and domains from Meta that are no longer under your control.

| Meta field | Value |
| --- | --- |
| App domains | Hostname only, with no protocol or path |
| Platform / Website | `https://<domain>/flipbook` |
| Privacy policy URL | `https://<domain>/privacy` |
| Data deletion / instructions URL | `https://<domain>/data-deletion` |
| Valid OAuth redirect URI | `https://<domain>/api/auth/facebook/callback` |

Do not save these examples as if they were real URLs and do not use wildcards. First check that the public pages answer 200 without signing in. The deletion option is an **instructions URL**, not an automatic callback: requests are handled manually through the contact email shown on the privacy page.

The `/privacy` and `/data-deletion` pages describe how data is handled today and that manual channel. They do not implement automatic account deletion, and removing the app from Facebook does not delete Focus files by itself. Whoever runs the service must handle verified deletion requests and remove the account records, the provider index and the linked projects and media.

## OAuth settings

Recommended values in Meta:

- Client OAuth login and web OAuth login: on.
- HTTPS enforcement and strict redirect matching: on (Meta locks them).
- Embedded browser OAuth, device login, JavaScript SDK and Messenger: off.
- Redirect list: register the exact callback of the active domain and check it with Meta's validator.

These values serve the existing server-side flow. You do not need to enable the JavaScript SDK or add permissions for photos, videos, posts or friends.

## Publishing and testing

An app in **Development** mode only admits people with a role on it. For public access Meta requires standard access with verification for `public_profile` and `email`, and the Login panel asks for advanced access to `public_profile` for public use. Complete whatever Meta's review flow asks before announcing access to users without a role.

After the deploy and after saving the exact redirect:

1. Test with an administrator or test account of this app. Check the trip to Facebook, the return to Focus, and that `/api/auth/session` identifies the session.
2. Check cancelling the consent and signing out. The email may be unavailable; Focus treats it as optional.
3. Complete Meta's requirements and verify again with a user who has no role before considering public access enabled.

Having credentials configured does not mean the real Facebook round trip has been verified.

## Local checks

- The production image builds and type-checks.
- `/privacy` and `/data-deletion` return public HTML with 200, with the contact link present and no redirect to login.
- At 390 px width there is no horizontal overflow.
- With no credentials in the container, the production sign-in returns 503 and does not enable the simulation.

None of these use provider keys or consume Meta credits.
