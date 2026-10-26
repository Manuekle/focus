# mocks/

The demo business: **Optimed**, an optical clinic in Bogotá
(`optimed.ts`). One fixture, used in two places:

- `pnpm dev:mock` — the app on **port 3100** with this data in a throwaway
  home, beside a real `pnpm dev` on 3000, never instead of it.
- The hosted test tenant (prueba.oruka.si) — `pnpm fleet fixture prueba` in
  `oruka-fleet` calls the tenant's `POST /api/fleet/fixture`, which loads the
  same object (contract: `docs/hosted-fleet-contract.md`).

Both go through `lib/demo-fixture.ts`, so the clinic on localhost and the one
on prueba have the same contacts, deals, agents and conversations, down to the
ids. Change `optimed.ts` and both follow (prueba after a release and a
`pnpm fleet fixture prueba`).

```bash
pnpm dev:mock
```

```
usuario  demo@optimed.test
clave    optimed-demo-123
```

That login exists only in the mock. prueba keeps its own owner account: the
fixture replaces business data and never accounts, credentials or
connections, and a password committed here must never open a deployed
install.

On prueba the fixture also keeps what real people sent through the connected
WhatsApp number and Instagram account — those contacts, their deals,
reminders and transcripts — plus the automations, and hands the connected
number to Recepción. Everything else becomes Optimed.

## What the clinic shows

Four agents: **Recepción** answers WhatsApp and Instagram, and hands the
conversation to **Ventas** (prices, frames, contact lenses, corporate deals),
**Citas** (eye exams, moving and cancelling appointments) or **Postventa**
(warranties, complaints) when the person asks for that — the topic routing in
`lib/agent-routing.ts`, set under Mis agentes → "Quién atiende cada tema". The
transcripts in Historial show those hand-offs, one agent name per reply.

## How the mock avoids the database

`scripts/dev-mock.mjs` points `HOME` at `.mock-home/` (gitignored) and sets
`WORKFLOW_POSTGRES_URL` to an empty string. Every store in `lib/` resolves its
file as `homedir()/.oruka/<name>.json`, and `usingDb()` falls back to that file
store when the Postgres URL is empty — so the whole app lands inside the
throwaway directory with no production code changed.

The provider API keys are emptied the same way, so a mock run cannot bill a
real account: without this the shell's own `AI_GATEWAY_API_KEY` reached it and
the app reported the Gateway as configured. `OLLAMA_BASE_URL` is left alone —
it is an address, not a secret, and a local model costs nothing to call. With
no embedding model the knowledge base is stored as plain text; on a tenant
with one it is indexed for search.

The variable is emptied rather than deleted on purpose. `delete` would let
Next's dotenv loader read the real URL back out of `.env.local` a moment
later, and the mock run would quietly write to the production database. An
already-set variable, even `""`, is left alone.

## Rules for anything added to `optimed.ts`

**Make it obviously fake to a human.** Every address is `.test` — a reserved
TLD that cannot resolve — phones sit in the 555 range, and the street is
labelled as a test address. Data that looks plausibly real gets mistaken for
real: this repo once carried a fictional bakery across two workspaces that
nobody could account for months later.

**Keep dates relative.** Use the `hoursAgo` / `daysAgo` helpers inside
`optimedFixture(now)`, never a literal timestamp. A pinned fixture rots — six
months on, every conversation in the inbox reads as half a year old and the
product stops looking alive.

**Cover the states a screen is for.** The set carries `waiting_human`,
`followup_due`, `open` and `closed` contacts, deals in every stage including
`lost`, and conversations that moved between agents, because a fixture where
everything is fine cannot show what the inbox — or the routing — is for.
Contacts also carry the `triage.*` attributes that `lib/triage.ts` writes and
the `routing.*` ones `lib/agent-routing.ts` writes.

## Resetting

Every `pnpm dev:mock` start wipes `.mock-home/`. Click around freely — the
next run is identical to this one. prueba resets with
`pnpm fleet fixture prueba`.
