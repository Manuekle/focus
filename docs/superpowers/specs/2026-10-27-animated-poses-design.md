# Internal pose references

## Behavior

Focus chooses pose references internally from the complete POSE-DB-01 catalog.
The snapshot contains 288 postures and all 1,439 available camera images. The
existing movement and instruction controls remain the creation interface; there
is no pose selector. The existing planning call sees the uploaded drawing and
compatible metadata, chooses an idle base posture or optional guides per phase,
and keeps the fixed movement mechanics and the character identity.

## Boundaries

- Keep the complete metadata snapshot on the server. Share only validated image
  identifiers with saved-plan schemas. Never execute page scripts or redistribute
  source PNGs, thumbnails, or private cached references.
- Select only compatible single-character profile references for the current
  renderer. All 233 single-character postures are available for resting loops;
  moving actions additionally filter lower-body posture compatibility. Keep paired
  postures and other camera angles indexed without applying them to the wrong
  number of characters or changing the camera during a cycle.
- Send the original image to the existing planner, with compact descriptive
  metadata. Validate model-selected IDs deterministically and normalize camera
  variants to an existing side view. Never accept arbitrary URLs.
- A resting base posture retains its support points through eight ordered idle
  phases. Optional anatomy guides on other actions cannot override walk, run,
  jump, wave or fight mechanics. Upper-body references preserve full-body framing.
- Download only the guides used by requested frames, deduplicate within the run,
  bound response bytes, decoding and time, and reuse private cached PNGs.
- Save guide IDs in the plan for redraws and repairs. An unavailable automatic
  guide produces a visible caveat and text-guided generation; legacy explicit
  selections remain compatible and require their guide. Add no extra model call.

## Verification

Check exact catalog counts, unique IDs, missing-angle fidelity and family coverage;
unknown IDs, redirects, download bounds and cache reuse; automatic base and
per-phase selections, incompatible reference rejection and phase order; original
image reaching planning; redraw persistence and automatic-download fallback.
Run type checking, lint, animation lifecycle and export regressions. Inspect the
normal creation UI at desktop and mobile widths without calling paid providers.
