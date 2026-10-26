/**
 * Which page buttons a pager should render, given where we are and how many
 * pages exist.
 *
 * Always shows the first page, the last page, and a window around the current
 * one; the pages in between collapse into a gap marker. The result keeps a
 * constant length so the bar never resizes as you page through — a bar that
 * reflows under the cursor moves the button you were about to click.
 */
export function pageItems(page: number, pageCount: number): Array<number | "gap"> {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }

  const items: Array<number | "gap"> = [1];
  // Clamped so the window keeps its three slots at both ends of the range.
  const start = Math.max(2, Math.min(page - 1, pageCount - 4));
  const end = Math.min(pageCount - 1, Math.max(page + 1, 5));

  if (start > 2) items.push("gap");
  for (let p = start; p <= end; p++) items.push(p);
  if (end < pageCount - 1) items.push("gap");

  items.push(pageCount);
  return items;
}
