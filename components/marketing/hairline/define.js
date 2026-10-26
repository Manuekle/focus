/**
 * The figures end with `hairline({ … })`, the way the skill's bench expects
 * them to. On the bench that call mounts the figure; here it hands the
 * declaration back, so a figure module's default export is the figure itself.
 */
export const hairline = (figure) => figure;
