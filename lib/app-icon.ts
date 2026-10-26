/**
 * The app icon — the orca close up on its light tile — as SVG markup.
 *
 * Drawn to match the icon made in Apple's Icon Composer (Default appearance),
 * measured off its 4096px export: the tile's shape and gradients, the shadow
 * the orca casts on the tile and the lit lip along its edges are fitted to
 * those pixels, and so is where the orca sits — scale and offset found by
 * matching its body against the export's (96% overlap; the rest is the
 * export's soft edges). There is one appearance and it is the light one, so
 * every surface shows the icon a visitor has on their home screen whatever
 * the theme.
 *
 * One builder, so the favicon (`app/icon.svg`), the install and email PNGs,
 * the bare mark (`pnpm icons`, scripts/render-app-icons.ts), the share cards
 * and the in-product `OrukaTile` cannot drift apart.
 *
 * The orca is a close-up: it runs off the tile at the left and the foot, the
 * way the Icon Composer layer is placed. Its eye and eye patch stay well
 * inside the central circle a platform's own mask keeps.
 */

/** The orca's outline, in the logo's own units (8–1225 × 113–1198). */
export const ORCA_PATH =
  "M 427 113.592 C 425.075 113.820, 419 114.491, 413.500 115.084 C 397.683 116.788, 378.228 122.194, 365.500 128.421 C 348.526 136.725, 341 145.300, 341 156.334 C 341 166.375, 344.281 172.240, 361.427 192.846 C 389.119 226.126, 404.592 259.827, 407.886 294.038 C 410.716 323.424, 401.301 349.729, 381.464 367.859 C 378.452 370.611, 369.128 377.483, 360.744 383.130 C 273.153 442.116, 207.104 516.864, 156.739 614 C 129.730 666.090, 110.447 724.096, 99.447 786.342 L 98.061 794.184 82.781 809.368 C 66.772 825.275, 59.364 833.837, 49.035 848.371 C 23.070 884.904, 8.667 921.247, 8.558 950.500 C 8.464 975.741, 16.235 985.977, 35.500 985.983 C 49.474 985.988, 64.656 981.321, 90.408 969.105 C 97.507 965.737, 103.390 963.098, 103.482 963.241 C 103.574 963.383, 104.653 971.825, 105.880 982 C 111.806 1031.153, 123.371 1073.690, 141.830 1114.223 L 144.892 1120.945 141.967 1129.596 C 135.182 1149.670, 135.723 1155.115, 145.448 1164.666 C 156.135 1175.161, 184.338 1187.657, 208 1192.381 C 234.410 1197.654, 261.344 1199.098, 287.500 1196.642 C 302.198 1195.263, 325.217 1195.045, 457.500 1195.039 C 541.650 1195.035, 647.400 1195.018, 692.500 1195.001 L 774.500 1194.970 781.500 1186.240 C 811.843 1148.399, 852.668 1107.076, 893.411 1072.961 C 906.018 1062.405, 920.384 1051.039, 921.146 1051.018 C 921.501 1051.008, 925.618 1055.388, 930.294 1060.750 C 949.577 1082.862, 971.202 1102.758, 992.094 1117.607 C 1040.410 1151.950, 1088.065 1170.008, 1130.349 1169.996 C 1180.220 1169.982, 1218.682 1148.458, 1224.064 1117.551 C 1227.976 1095.089, 1216.276 1055.118, 1195.725 1020.732 C 1182.697 998.935, 1169.698 982.609, 1148.543 961.476 C 1128.007 940.960, 1111.563 927.176, 1088.654 911.272 L 1084.004 908.044 1094.088 895.772 C 1119.922 864.331, 1145.035 825.911, 1162.245 791.500 C 1183.767 748.467, 1196.646 709.385, 1203.127 667.439 C 1205.682 650.907, 1206.040 619.967, 1203.839 606 C 1202.649 598.445, 1202.701 596.166, 1204.309 585.500 C 1206.418 571.515, 1206.090 551.978, 1203.508 537.706 C 1198.963 512.585, 1185.485 487.423, 1166.780 469.143 C 1153.198 455.869, 1140.711 447.816, 1116.805 436.911 C 1108.534 433.138, 1101.126 429.519, 1100.341 428.868 C 1099.557 428.218, 1096.797 424.494, 1094.208 420.594 C 1078.391 396.770, 1070.012 386.086, 1055.046 370.660 C 1036.828 351.880, 1015.531 335.435, 991.938 321.930 C 949.968 297.904, 900.107 280.866, 849 273.087 C 812.239 267.492, 800.701 266.649, 759.834 266.571 C 739.117 266.532, 721.955 266.275, 721.695 266 C 721.435 265.725, 717.720 260.775, 713.439 255 C 692.779 227.129, 658.656 193.713, 633.219 176.443 C 583.518 142.699, 536.449 123.474, 485 115.902 C 472.137 114.009, 435.730 112.559, 427 113.592 Z";

/** The eye patch and the eye. */
export const ORCA_EYES_PATH =
  "M 547.859 535.522 C 502.943 541.650, 443.397 569.921, 402 604.771 C 390.763 614.231, 371.050 634.273, 361.989 645.451 C 351.811 658.006, 338.015 679.380, 331.299 693 C 320.476 714.948, 316 730.827, 316 747.276 C 316 795.607, 367.175 813.123, 431.416 786.781 C 461.921 774.272, 499.495 749.353, 529.424 721.782 C 540.828 711.277, 566.434 684.534, 573.739 675.500 C 609.005 631.888, 627.191 593.444, 623.089 571.181 C 619.307 550.654, 603.667 538.319, 577.325 535.088 C 566.394 533.747, 560.193 533.839, 547.859 535.522 Z M 705.500 548.162 C 694.515 554.211, 691.884 566.594, 699.815 574.923 C 708.386 583.924, 722.029 581.752, 727.104 570.579 C 729.577 565.132, 729.468 561.199, 726.697 555.960 C 722.881 548.744, 711.828 544.678, 705.500 548.162 Z";

/** The chest, which meets the outline along the throat and the belly. */
export const ORCA_CHEST_PATH =
  "M 1142.803 548.079 C 1124.935 550.700, 1104.464 561.503, 1079.655 581.405 C 1053.772 602.169, 1039.371 611.867, 1022.069 620.185 C 1009.195 626.375, 988.930 633.198, 975 636.033 C 951.667 640.783, 944.294 641.254, 889 641.531 C 860.125 641.676, 830.584 642.301, 823.354 642.921 C 738.427 650.204, 650.192 687.816, 572.757 749.746 C 533.434 781.194, 491.047 825.095, 458.581 868 C 447.734 882.334, 442 890.458, 442 891.491 C 442 891.837, 445.038 891.827, 448.750 891.467 C 457.699 890.600, 470.380 892.449, 480.378 896.079 C 508.346 906.232, 521.377 934.139, 517.966 976.576 C 512.528 1044.225, 475.010 1108.461, 417.299 1148.933 C 386.882 1170.264, 349.699 1186.510, 317.273 1192.636 C 312.198 1193.595, 308.214 1194.547, 308.419 1194.752 C 308.750 1195.084, 365.977 1195.121, 692.500 1195 L 774.500 1194.970 781.500 1186.240 C 798.484 1165.059, 814.075 1147.830, 836.952 1124.961 C 870.882 1091.042, 873.522 1088.769, 953.500 1024.578 C 1014.728 975.436, 1030.276 962.308, 1051.419 941.900 C 1142.672 853.819, 1204.901 729.934, 1205.327 635.500 C 1205.372 625.307, 1204.824 613.379, 1204.062 608 C 1203.321 602.775, 1202.705 597.057, 1202.691 595.294 C 1202.678 593.531, 1202.341 592.289, 1201.943 592.535 C 1201.545 592.781, 1200.934 591.462, 1200.586 589.604 C 1199.546 584.066, 1195.107 574.048, 1191.032 568.048 C 1183.470 556.912, 1172.917 550.112, 1160 548.052 C 1152.704 546.888, 1150.906 546.891, 1142.803 548.079 Z";

/** All of its white, inside the outline. */
const ORCA_LIGHT_PATH = `${ORCA_EYES_PATH} ${ORCA_CHEST_PATH}`;

/** The light along the edge of the near flipper. */
const ORCA_FIN_PATH =
  "M 440.732 891.594 C 440.604 891.717, 435.325 892.745, 429 893.880 C 366.156 905.148, 291.295 944.961, 235.816 996.620 C 219.502 1011.811, 201.811 1031.176, 188.413 1048.507 C 182.574 1056.060, 166.275 1080.514, 160.528 1090.344 C 148.766 1110.461, 137.467 1138.225, 138.199 1145.209 C 138.481 1147.895, 138.881 1147.550, 144.478 1139.789 C 171.136 1102.826, 213.789 1054.755, 247.326 1023.878 C 305.814 970.027, 377.956 926.078, 442 905.281 C 450.197 902.619, 480.435 896.960, 482.940 897.619 C 483.798 897.845, 483.007 897.334, 481.183 896.485 C 474.069 893.171, 466.378 891.798, 453.732 891.585 C 446.709 891.467, 440.859 891.470, 440.732 891.594 Z";

/**
 * The mark in one colour is the outline with the white cut out of it, so the
 * ground shows through the eye patch, the eye and the chest whatever the fill
 * is. It is cut with a mask, not as one `evenodd` path: where the chest meets
 * the outline the drawing runs the two edges a hair apart, and subtracted
 * as paths that hair stays behind as a dark line down the throat. In the mask
 * the chest is stroked `MARK_CHEST_BLEED` units wider, so it runs past the
 * outline and the hair goes with it.
 */
export const MARK_CHEST_BLEED = 6;

/** The mark's ink box, which is also the logo's own canvas. */
export const MARK_VIEWBOX = "8 113 1217 1085";

/** The mark's mask, black where the white is cut out. `id` must be unique on the page. */
export function markMaskSvg(id: string): string {
  const [x, y, width, height] = MARK_VIEWBOX.split(" ");
  return [
    `<mask id="${id}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${width}" height="${height}">`,
    `<path d="${ORCA_PATH}" fill="#fff"/>`,
    `<path d="${ORCA_EYES_PATH}" fill="#000" fill-rule="evenodd"/>`,
    `<path d="${ORCA_CHEST_PATH}" fill="#000" stroke="#000" stroke-width="${MARK_CHEST_BLEED}" stroke-linejoin="round"/>`,
    "</mask>",
  ].join("");
}

/** Where the orca sits on the 1024 tile: fitted against the export. */
const ORCA_PLACEMENT = "translate(-83.7 10.65) scale(0.852)";

/**
 * The tile on a 1024 canvas: Apple's continuous corner (Figma's "iOS" corner
 * smoothing, 60%) at radius 268. Fitted against the export's alpha — a plain
 * `rx` rounded rectangle, which the old favicon used, has a visible kink where
 * the arc meets the straight edge.
 */
export const TILE_PATH =
  "M 595.2 0 c 150.09 0 225.14 0 282.46 29.21 a 268 268 0 0 1 117.12 117.12 c 29.21 57.32 29.21 132.37 29.21 282.46 L 1024 595.2 c 0 150.09 0 225.14 -29.21 282.46 a 268 268 0 0 1 -117.12 117.12 c -57.32 29.21 -132.37 29.21 -282.46 29.21 L 428.8 1024 c -150.09 0 -225.14 0 -282.46 -29.21 a 268 268 0 0 1 -117.12 -117.12 c -29.21 -57.32 -29.21 -132.37 -29.21 -282.46 L 0 428.8 c 0 -150.09 0 -225.14 29.21 -282.46 a 268 268 0 0 1 117.12 -117.12 c 57.32 -29.21 132.37 -29.21 282.46 -29.21 Z";

const SQUARE_PATH = "M 0 0 H 1024 V 1024 H 0 Z";

type Stop = readonly [offset: number, colour: string];

const stops = (list: readonly Stop[]) =>
  list.map(([offset, colour]) => `<stop offset="${offset}" stop-color="${colour}"/>`).join("");

/** White at the top, settling into a cool lavender at the foot. */
const TILE_STOPS: readonly Stop[] = [
  [0, "#ffffff"],
  [0.16, "#ffffff"],
  [0.5, "#f3f4fb"],
  [0.88, "#e8eaf7"],
  [1, "#e5e7f6"],
];

/** The glass edge: white across the top and the foot, a grey lip down the sides. */
const RIM_STOPS: readonly Stop[] = [
  [0, "#ffffff"],
  [0.12, "#ffffff"],
  [0.3, "#e1e2ea"],
  [0.78, "#dedfea"],
  [0.87, "#ffffff"],
  [1, "#ffffff"],
];

/** Near-black at the dorsal fin, lifting to graphite where the tile cuts the orca off. */
const ORCA_STOPS: readonly Stop[] = [
  [0, "#171718"],
  [0.13, "#181819"],
  [0.26, "#1c1b1c"],
  [0.39, "#201f21"],
  [0.52, "#262527"],
  [0.65, "#2d2d2e"],
  [0.78, "#353537"],
  [0.91, "#3f3e42"],
  [1, "#444347"],
];

/** The white, a breath cooler towards the foot. */
const LIGHT_STOPS: readonly Stop[] = [
  [0, "#f9f9fa"],
  [1, "#f4f5f8"],
];

/** The flipper's lit edge. */
const FIN_COLOUR = "#4c4b52";

export type AppIconOptions = {
  /**
   * `squircle` draws the tile's own outline and its glass edge. `square` is
   * full bleed, for the platforms that cut their own mask out of it — the
   * Apple touch icon and the maskable PWA icon — where transparent corners
   * would come out black.
   */
  readonly shape?: "squircle" | "square";
  /** Prefix for the element ids, unique per inline copy on a page. */
  readonly id?: string;
  /** Pixel size written on the root element; omit for inline use. */
  readonly size?: number;
};

export function appIconSvg({ shape = "squircle", id = "oruka-icon", size }: AppIconOptions = {}): string {
  const tile = shape === "squircle" ? TILE_PATH : SQUARE_PATH;
  const dimensions = size ? ` width="${size}" height="${size}"` : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"${dimensions}>`,
    "<defs>",
    `<linearGradient id="${id}-tile" x1="0" x2="0" y1="0" y2="1">${stops(TILE_STOPS)}</linearGradient>`,
    shape === "squircle"
      ? `<linearGradient id="${id}-rim" x1="0" x2="0" y1="0" y2="1">${stops(RIM_STOPS)}</linearGradient>`
      : "",
    `<linearGradient id="${id}-fill" x1="0" x2="0" y1="0" y2="1">${stops(ORCA_STOPS)}</linearGradient>`,
    `<linearGradient id="${id}-light" x1="0" x2="0" y1="0" y2="1">${stops(LIGHT_STOPS)}</linearGradient>`,
    `<path id="${id}-orca" d="${ORCA_PATH}" fill-rule="evenodd" transform="${ORCA_PLACEMENT}"/>`,
    `<clipPath id="${id}-clip"><path d="${tile}"/></clipPath>`,
    // In the orca's own units: it clips a group that carries the placement.
    `<clipPath id="${id}-body"><path d="${ORCA_PATH}" fill-rule="evenodd"/></clipPath>`,
    // The shadow the orca casts on the tile: straight down, soft, faintly blue.
    `<filter id="${id}-shadow" x="-15%" y="-10%" width="130%" height="130%" color-interpolation-filters="sRGB">`,
    `<feGaussianBlur in="SourceAlpha" stdDeviation="24"/><feOffset dy="26"/>`,
    `<feComponentTransfer result="cast"><feFuncA type="linear" slope="0.12"/></feComponentTransfer>`,
    `<feFlood flood-color="#1c1d3a"/><feComposite operator="in" in2="cast"/></filter>`,
    // The lit lip: a few pixels of light inside every edge that faces up or
    // down — the shape minus itself shifted, softened, kept inside the shape.
    // Brighter along the underside, as in the export; the sides stay dark.
    `<filter id="${id}-lip" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">`,
    `<feOffset in="SourceAlpha" dy="-5" result="up"/><feComposite in="SourceAlpha" in2="up" operator="out" result="under"/>`,
    `<feOffset in="SourceAlpha" dy="5" result="down"/><feComposite in="SourceAlpha" in2="down" operator="out" result="over"/>`,
    `<feGaussianBlur in="under" stdDeviation="1.5" result="under-soft"/><feGaussianBlur in="over" stdDeviation="1.5" result="over-soft"/>`,
    `<feFlood flood-color="#c9c9d8" flood-opacity="0.45"/><feComposite in2="under-soft" operator="in" result="under-lit"/>`,
    `<feFlood flood-color="#c9c9d8" flood-opacity="0.3"/><feComposite in2="over-soft" operator="in" result="over-lit"/>`,
    `<feMerge result="lips"><feMergeNode in="under-lit"/><feMergeNode in="over-lit"/></feMerge>`,
    `<feComposite in="lips" in2="SourceAlpha" operator="in" result="lit"/>`,
    `<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="lit"/></feMerge></filter>`,
    shape === "squircle"
      ? `<filter id="${id}-soften" x="-2%" y="-2%" width="104%" height="104%"><feGaussianBlur stdDeviation="1.5"/></filter>`
      : "",
    "</defs>",
    `<path d="${tile}" fill="url(#${id}-tile)"/>`,
    shape === "squircle"
      ? `<path d="${tile}" fill="none" stroke="url(#${id}-rim)" stroke-width="16" filter="url(#${id}-soften)" clip-path="url(#${id}-clip)"/>`
      : "",
    `<g clip-path="url(#${id}-clip)">`,
    `<g filter="url(#${id}-shadow)"><use href="#${id}-orca"/></g>`,
    `<g filter="url(#${id}-lip)"><use href="#${id}-orca" fill="url(#${id}-fill)"/></g>`,
    // The white and the flipper's light, kept inside the outline.
    `<g transform="${ORCA_PLACEMENT}" clip-path="url(#${id}-body)">`,
    `<path d="${ORCA_LIGHT_PATH}" fill="url(#${id}-light)" fill-rule="evenodd"/>`,
    `<path d="${ORCA_FIN_PATH}" fill="${FIN_COLOUR}"/>`,
    "</g>",
    "</g>",
    "</svg>",
  ].join("");
}
