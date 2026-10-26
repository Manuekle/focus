// Shape of an Enterprise license and what verifying one can tell the app.
//
// `edition` and `features` are open strings on purpose: a future "partner-oem"
// edition, or a new feature flag, is a new value issued into these fields —
// never a change to the verifier or the token format itself.

export type LicenseEdition = "enterprise" | "partner-oem" | (string & {});

export type LicensePayload = {
  readonly licenseId: string;
  readonly company: string;
  readonly customerEmail: string;
  readonly edition: LicenseEdition;
  readonly deploymentType: "self-hosted";
  readonly features: readonly string[];
  /** ISO timestamp. The perpetual right to run this version starts here and never ends. */
  readonly issuedAt: string;
  /**
   * ISO timestamp. Governs eligibility for new versions and support only —
   * never checked to decide whether the app runs. See `deriveLicenseInfo`.
   */
  readonly maintenanceUntil: string;
  /**
   * The installation this license was issued for — `~/.oruka/installation-id`
   * on the customer's machine at the time they requested it, see
   * `lib/license/installation.ts`. Absent on licenses issued before this
   * field existed, and on any license issued without an activation exchange;
   * absent is not the same as mismatched — see `LicenseInfo.installationMatches`.
   */
  readonly installationId?: string;
  readonly schemaVersion: 1;
};

export type LicenseStatus = "valid" | "missing" | "invalid_signature" | "malformed";

export type LicenseInfo = {
  readonly status: LicenseStatus;
  readonly payload: LicensePayload | null;
  /** Whether `maintenanceUntil` has not yet passed. Informational only. */
  readonly maintenanceActive: boolean;
  readonly daysUntilMaintenanceEnds: number | null;
  /**
   * Whether `payload.installationId` matches this machine's own id.
   * `null` means the license doesn't specify one (unbound, or issued before
   * activation existed) — not a claim either way. `false` never blocks
   * anything; it's a signal for the UI and for support conversations, not
   * enforcement — see docs/commercial-licensing.md.
   */
  readonly installationMatches: boolean | null;
};
