/**
 * Brand logo geometry (XW mark).
 *
 * Four flat polygons traced from the master artwork. Coordinates are in the
 * original artwork's pixel space; `LOGO_VIEWBOX` crops tightly around them so
 * the logo can be scaled to any size with no built-in padding.
 *
 * Keep in sync with scripts/generate-assets.js and src/assets/xw-logo.svg.
 */

/** Tight bounding box of the logo: `minX minY width height`. */
export const LOGO_VIEWBOX = '73 437 1107 436';

/** Width ÷ height of the logo (≈ 2.54). */
export const LOGO_ASPECT = 1107 / 436;

/** SVG path data, one entry per polygon. */
export const LOGO_PATHS: readonly string[] = [
  // X – left half
  'M73 439 L250 659 L81 870 L237 870 L330 757 L422 870 L581 870 L236 439 Z',
  // X – diagonal slash
  'M302 437 L643 870 L799 870 L461 437 Z',
  // Small triangle between X and W
  'M777 437 L591 437 L560 489 L665 623 Z',
  // W
  'M1179 438 L1018 438 L904 624 L844 512 L790 512 L699 664 L773 758 L814 695 L914 872 Z',
];
