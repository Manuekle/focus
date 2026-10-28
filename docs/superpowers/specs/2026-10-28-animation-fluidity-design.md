# Character animation fluidity

Approved in chat on 2026-10-28: continuous travel at 60 fps and additional drawn
in-betweens up to 24 distinct drawings per second, preserving cycle length.
Generating paid drawings remains a separate action with its full cost shown.

## Design

- Preview and MP4 share the continuous output clock for root travel. Subpixel
  composition keeps slow travel smooth; a fixed background must not cause the
  exporter to reuse a travelling pose's previous composition.
- Keep the eight key poses and their existing cycle pace (8 or 12 key poses/s).
  Fill the 24 Hz exposure sheet at the needed fractions between those keys.
  Store each in-between's temporal position, source versions and stable ID.
- Retain existing halfway drawings and reuse previously generated densities
  when changing pace. Stale drawings remain excluded after key edits or reorder.
  Registration interpolates the bob chart and lift at the same temporal position.
- Show the effective drawing rate and the complete generation cost. Existing
  access checks, paid-work guards, confirmation and failed-call refunds apply
  to the complete set. Old API requests retain their midpoint behavior.
- Preview, MP4, GIF and atlases use the same position-aware exposure sheet.
  MP4 remains 60 fps; GIF remains 24 fps. Atlas integer durations use cumulative
  rounding to avoid drift. Bump the export cache version.
- Existing multi-character scenes retain their fixed choreography and do not
  gain cycle in-betweens. No automatic paid generation or optical-flow morphing.

## Implementation and verification

1. Extend shared IDs, in-between positions, generation targets and exposure math.
2. Pass fractional progress through the API, budgeted generation, prompt and
   registration; reuse the existing controls for dense generation.
3. Run continuous travel in preview/export and compose fractional positions.
4. Verify all actions at both key paces, legacy compatibility, density changes,
   stale regeneration, exact costs, decoded MP4 motion and atlas duration.
5. Run TypeScript, ESLint and relevant integration tests; inspect the local UI.

More generated poses still require visual review for identity and anatomy.
Output frame rate is distinct from the number of unique character drawings.

## Native dance extension

The user requested a real test with the provided Reze illustration, a dance
reference and 20 seconds, and declined external video plugins. Add a repeating
eight-key dance at four key poses/s (two seconds per cycle), 20-second cycle
exports and sixth-position in-betweens. A complete cycle has 48 drawings:
eight keys plus 40 in-betweens. Equivalent fractions reuse existing IDs.
Keep multi-character scenes limited to six seconds and living-picture loops
limited to their existing 2/4/6 seconds. The user explicitly authorized the
40 additional drawings after reviewing the generated key poses; the live
animation has a 49-drawing budget including its prepared frontal reference.
