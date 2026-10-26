import { NextResponse } from "next/server";
import {
  apiError,
  apiErrorBody,
  apiFailure,
  missingField,
  withApiErrors,
  type ApiErrorCode,
} from "@/lib/api-error";
import {
  SearchConsoleError,
  compareRows,
  connectionHasScope,
  defaultSite,
  isRangeId,
  listSites,
  lostRows,
  periodsFor,
  queryRows,
  queryTotals,
  type Period,
  type RangeId,
  type SearchRow,
  type SiteEntry,
} from "@/lib/search-console";
import {
  createSeoChange,
  deleteSeoChange,
  getSeoSite,
  listSeoChanges,
  setSeoSite,
} from "@/lib/seo-store";

export const dynamic = "force-dynamic";

// GET    /api/seo?tab=overview&range=28d  — totals, the daily series, devices, countries
// GET    /api/seo?tab=queries&range=28d   — keywords, each against the previous window
// GET    /api/seo?tab=pages&range=28d     — the same, per URL
// POST   /api/seo                         — log a change ({ date, note })
// PATCH  /api/seo                         — switch the watched property ({ site })
// DELETE /api/seo?id=<change_id>          — drop a logged change

/** How many rows a dimensioned read asks for.
 *
 *  Well past what the table shows, and deliberately: the comparison needs the
 *  earlier window's row for a keyword that has since climbed into the top ten,
 *  and a limit of ten would not have fetched it. The API's own ceiling is
 *  25,000 and a site with more queries than this has a different problem. */
const ROW_LIMIT = 500;

/** Ranked lists on the overview, where the story is the shape and six rows
 *  is where a ranked list stops being read. */
const BREAKDOWN_LIMIT = 25;

/** The reply for an install with no Google account connected. A 200 on
 *  purpose: not being connected yet is a normal state of the app, not a
 *  failed request, and answering 4xx made every page load log a failure
 *  nobody could act on. */
function notConnected() {
  return NextResponse.json(
    apiErrorBody("not_configured", {
      message: "Connect a Google account with Search Console access to see SEO metrics.",
    }),
    { status: 200 },
  );
}

/** Google's refusal, in this app's vocabulary. `detail` carries Google's own
 *  sentence, which the banner prints under the translated line — for a
 *  property the account cannot read, that sentence is the whole diagnosis. */
function searchConsoleFailure(error: unknown) {
  if (!(error instanceof SearchConsoleError)) return apiFailure(error, "upstream_failed");

  const code: ApiErrorCode =
    error.status === 401
      ? "unauthorized"
      : error.status === 403
        ? "forbidden"
        : error.status === 429 || error.reason === "rateLimitExceeded"
          ? "rate_limited"
          : error.status === 404
            ? "not_found"
            : "upstream_failed";

  return apiError(code, { detail: error.message });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Which property this request is about.
 *
 * The query string wins so the picker can preview a property before committing
 * to it, then the stored choice, then whichever default the list suggests. A
 * site named in the URL but not in the list is refused rather than passed
 * through: it would otherwise reach Google as an unshared property and come
 * back as a 403 that reads like a permissions bug.
 */
async function resolveSite(
  requested: string | null,
  sites: readonly SiteEntry[],
): Promise<string | null> {
  if (requested) return sites.some((site) => site.url === requested) ? requested : null;
  const stored = await getSeoSite();
  if (stored && sites.some((site) => site.url === stored)) return stored;
  return defaultSite(sites);
}

/** `YYYY-MM-DD`, and a real day rather than a plausible-looking one — `2026-02-31`
 *  parses under a looser check and then silently sorts into the wrong place. */
function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// ── Reads ──────────────────────────────────────────────────────────

async function overview(site: string, current: Period, previous: Period) {
  // Five calls that do not depend on each other. Sequentially this is most of
  // a second each against a year of data; in parallel the page waits once.
  //
  // The earlier window is asked for as totals only, not as a second daily
  // series. The comparison this page makes is period against period — which
  // the totals answer — and Search Console quota is per property: a sixth call
  // per page load buys a series nothing on screen draws.
  const [totalsNow, totalsBefore, seriesNow, devices, countries] = await Promise.all([
    queryTotals(site, current),
    queryTotals(site, previous),
    queryRows({ site, period: current, dimensions: ["date"], rowLimit: 400 }),
    queryRows({ site, period: current, dimensions: ["device"], rowLimit: BREAKDOWN_LIMIT }),
    queryRows({ site, period: current, dimensions: ["country"], rowLimit: BREAKDOWN_LIMIT }),
  ]);

  return {
    totals: { current: totalsNow, previous: totalsBefore },
    // Ascending, because a chart is read left to right and Google ranks its
    // rows by clicks even when the dimension is a date.
    series: { current: byDate(seriesNow) },
    devices,
    countries,
  };
}

function byDate(rows: readonly SearchRow[]): SearchRow[] {
  return [...rows].sort((a, b) => a.key.localeCompare(b.key));
}

async function dimensioned(site: string, current: Period, previous: Period, dimension: "page" | "query") {
  const [now, before] = await Promise.all([
    queryRows({ site, period: current, dimensions: [dimension], rowLimit: ROW_LIMIT }),
    queryRows({ site, period: previous, dimensions: [dimension], rowLimit: ROW_LIMIT }),
  ]);
  return { rows: compareRows(now, before), lost: lostRows(now, before).slice(0, BREAKDOWN_LIMIT) };
}

export const GET = withApiErrors(async function GET(request: Request) {
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") ?? "overview";
  const rangeParam = url.searchParams.get("range") ?? "28d";
  const range: RangeId = isRangeId(rangeParam) ? rangeParam : "28d";

  let sites: SiteEntry[];
  try {
    sites = await listSites();
  } catch (error) {
    // No connected account and no service account: the store has nothing to
    // read from, which is a state of the install rather than a failure.
    if (error instanceof SearchConsoleError && error.status === 401) return notConnected();
    // A 403 on the *list* call is almost always the stale-grant case: a token
    // issued before this page existed is valid, just not for Search Console.
    if (error instanceof SearchConsoleError && error.status === 403 && !(await connectionHasScope())) {
      return NextResponse.json({ sites: [], needsScope: true, range }, { status: 200 });
    }
    return searchConsoleFailure(error);
  }

  const changes = await listSeoChanges();
  const { current, previous } = periodsFor(range);
  const base = { sites, range, period: { current, previous }, changes };

  // A connected account that has verified nothing. Not an error — the panel
  // explains what to do in Search Console rather than showing a banner.
  const site = await resolveSite(url.searchParams.get("site"), sites);
  if (!site) return NextResponse.json({ ...base, site: null }, { status: 200 });

  try {
    if (tab === "queries" || tab === "pages") {
      const dimension = tab === "queries" ? "query" : "page";
      return NextResponse.json({ ...base, site, ...(await dimensioned(site, current, previous, dimension)) });
    }
    return NextResponse.json({ ...base, site, ...(await overview(site, current, previous)) });
  } catch (error) {
    if (error instanceof SearchConsoleError && error.status === 403 && !(await connectionHasScope())) {
      return NextResponse.json({ ...base, site, needsScope: true }, { status: 200 });
    }
    return searchConsoleFailure(error);
  }
});

// ── Writes ─────────────────────────────────────────────────────────

export const POST = withApiErrors(async function POST(request: Request) {
  const body = await readJson(request);
  if (!body) return apiError("invalid_json");

  const date = body.date;
  const note = body.note;
  if (!isIsoDay(date)) return apiError("invalid_field", { field: "date", message: "date must be YYYY-MM-DD." });
  if (typeof note !== "string" || !note.trim()) return missingField("note");
  // A change dated in the future has no traffic either side of it to compare,
  // and is nearly always a typo in the year.
  if (date > new Date().toISOString().slice(0, 10)) {
    return apiError("invalid_field", { field: "date", message: "date can't be in the future." });
  }

  return NextResponse.json({ change: await createSeoChange({ date, note: note.slice(0, 200) }) });
});

export const PATCH = withApiErrors(async function PATCH(request: Request) {
  const body = await readJson(request);
  if (!body) return apiError("invalid_json");
  const site = body.site;
  if (typeof site !== "string" || !site) return missingField("site");

  // Only a property this account can actually read. Storing an arbitrary
  // string would park the panel on a permanent 403 with no way back.
  const sites = await listSites().catch(() => [] as SiteEntry[]);
  if (!sites.some((entry) => entry.url === site)) return apiError("not_found", { field: "site" });

  await setSeoSite(site);
  return NextResponse.json({ site });
});

export const DELETE = withApiErrors(async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return missingField("id");
  if (!(await deleteSeoChange(id))) return apiError("not_found");
  return NextResponse.json({ ok: true });
});
