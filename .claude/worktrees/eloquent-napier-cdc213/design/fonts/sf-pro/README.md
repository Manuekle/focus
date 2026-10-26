# San Francisco Pro Fonts

Obtained from [https://developer.apple.com/fonts/](https://developer.apple.com/fonts/)

Design masters only — kept outside `public/` so they are never served to
browsers. Apple devices use their installed copies through the
`"SF Pro Rounded"` / `ui-rounded` / `-apple-system` names (see
`app/globals.css`); other platforms use SN Pro, with Inter as fallback. Do not
move these files under `public/` or add `@font-face` rules pointing at them:
shipping Apple fonts to non-Apple devices violates their license, and
`tests/font-platform.test.ts` forbids downloadable Apple font files.

Optimized `.woff2` (full glyph coverage, no subsetting), generated with
`python scripts/optimize_fonts.py --root .`. Unoptimized originals removed;
these files are the masters.
