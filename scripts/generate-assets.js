#!/usr/bin/env node
/**
 * Generate app icon and splash-screen assets from the XW brand logo.
 *
 * The logo is four flat polygons (see LOGO below), white on a black ground.
 *
 * These source PNGs live in src/assets/ and are referenced by app.json.
 * Expo prebuild (npx expo prebuild --clean) reads app.json and generates
 * the platform-specific native assets in ios/ and android/ automatically.
 *
 * Usage:  node scripts/generate-assets.js   (or: npm run generate-assets)
 * Requires: sharp (npm i -D sharp)
 */

const fs = require('fs');
const sharp = require('sharp');
const path = require('path');

const BLACK = '#000000';
const WHITE = '#FFFFFF';
const ASSETS_DIR = path.resolve(__dirname, '..', 'src', 'assets');

/**
 * Logo geometry in the master artwork's pixel space. `x`, `y`, `w`, `h` are
 * the tight bounding box. Keep in sync with src/constants/logo.ts.
 */
const LOGO = {
  x: 73,
  y: 437,
  w: 1107,
  h: 436,
  paths: [
    'M73 439 L250 659 L81 870 L237 870 L330 757 L422 870 L581 870 L236 439 Z',
    'M302 437 L643 870 L799 870 L461 437 Z',
    'M777 437 L591 437 L560 489 L665 623 Z',
    'M1179 438 L1018 438 L904 624 L844 512 L790 512 L699 664 L773 758 L814 695 L914 872 Z',
  ],
};

/** The logo's <path> elements, in the artwork's own coordinates. */
function logoPaths(color) {
  return LOGO.paths.map((d) => `<path d="${d}" fill="${color}"/>`).join('');
}

/**
 * Build an SVG string of the logo centred on a square canvas.
 *
 * @param {number} size         Canvas width & height
 * @param {string} bgColor      Background fill (use 'none' for transparent)
 * @param {string} logoColor    Logo fill colour
 * @param {number} logoScale    0-1, logo width as a fraction of the canvas width
 * @param {number} cornerRadius Rounding for background rect (0 = none)
 */
function buildSvg(size, bgColor, logoColor, logoScale = 0.6, cornerRadius = 0) {
  const logoW = size * logoScale;
  const s = logoW / LOGO.w;
  const logoH = LOGO.h * s;
  const tx = (size - logoW) / 2 - LOGO.x * s;
  const ty = (size - logoH) / 2 - LOGO.y * s;

  const bgRect =
    bgColor === 'none'
      ? ''
      : `<rect width="${size}" height="${size}" rx="${cornerRadius}" ry="${cornerRadius}" fill="${bgColor}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bgRect}
  <g transform="translate(${tx} ${ty}) scale(${s})">${logoPaths(logoColor)}</g>
</svg>`;
}

/**
 * Logo-only SVG, cropped to the logo's bounding box (no padding), at the
 * artwork's native size. The bootsplash plugin sizes the native splash from
 * its aspect ratio.
 */
function buildTightSvg(logoColor) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LOGO.w}" height="${LOGO.h}" viewBox="${LOGO.x} ${LOGO.y} ${LOGO.w} ${LOGO.h}">${logoPaths(logoColor)}</svg>`;
}

async function generate() {
  // 1. App icon (iOS + Android fallback) – 1024×1024, black bg, white logo
  const iconSvg = buildSvg(1024, BLACK, WHITE, 0.62, 0);
  await sharp(Buffer.from(iconSvg))
    .png()
    .toFile(path.join(ASSETS_DIR, 'icon.png'));
  console.log('✔  icon.png (1024×1024)');

  // 2. Android adaptive icon foreground – 1024×1024, black bg, white logo.
  //    Android masks the icon to a circle-ish safe zone, so the logo is smaller.
  const adaptiveSvg = buildSvg(1024, BLACK, WHITE, 0.52, 0);
  await sharp(Buffer.from(adaptiveSvg))
    .png()
    .toFile(path.join(ASSETS_DIR, 'adaptive-icon.png'));
  console.log('✔  adaptive-icon.png (1024×1024)');

  // 3. Splash logo SVG – vector source for react-native-bootsplash plugin.
  //    Transparent bg + white logo, cropped tight. The plugin rasterises this
  //    at every density (@1x – @4x) so the native splash is always crisp.
  fs.writeFileSync(path.join(ASSETS_DIR, 'splash-logo.svg'), buildTightSvg(WHITE));
  console.log(`✔  splash-logo.svg (${LOGO.w}×${LOGO.h} vector)`);

  // 3b. Standalone logo SVG – the brand mark, white on transparent.
  fs.writeFileSync(path.join(ASSETS_DIR, 'xw-logo.svg'), buildTightSvg(WHITE));
  console.log('✔  xw-logo.svg');

  // 4. Favicon – 48×48, black bg, white logo
  const faviconSvg = buildSvg(48, BLACK, WHITE, 0.74, 6);
  await sharp(Buffer.from(faviconSvg))
    .png()
    .toFile(path.join(ASSETS_DIR, 'favicon.png'));
  console.log('✔  favicon.png (48×48)');

  // 5. Starred-songs cover – 600×600, black bg, white logo, JPEG
  const starredSvg = buildSvg(600, BLACK, WHITE, 0.6, 0);
  await sharp(Buffer.from(starredSvg))
    .jpeg({ quality: 90 })
    .toFile(path.join(ASSETS_DIR, 'starred-cover.jpg'));
  console.log('✔  starred-cover.jpg (600×600)');

  // 6. Now-playing / cover-art placeholder – 512×512, MILD gray (dark bg, faint
  //    logo) to match the in-app CachedImage placeholder; no bright flash. Small
  //    JPEG. Also emitted as a base64 module because RNQP's `placeholderArtworkUri`
  //    needs an on-disk file:// written at boot — see nowPlayingPlaceholder.ts.
  const placeholderJpg = await sharp(Buffer.from(buildSvg(512, '#181818', '#3a3a3a', 0.52)))
    .jpeg({ quality: 82 })
    .toBuffer();
  fs.writeFileSync(path.join(ASSETS_DIR, 'nowplaying-placeholder.jpg'), placeholderJpg);
  fs.writeFileSync(
    path.resolve(__dirname, '..', 'src', 'services', 'nowPlayingPlaceholderData.ts'),
    '// AUTO-GENERATED by scripts/generate-assets.js — do not edit by hand.\n' +
      '// base64 of src/assets/nowplaying-placeholder.jpg (mild gray logo, matches\n' +
      '// the in-app cover-art placeholder). Embedded so it can be written to a file://\n' +
      "// path at boot for RNQP's placeholderArtworkUri (which requires an on-disk file).\n" +
      'export const NOWPLAYING_PLACEHOLDER_JPEG_BASE64 =\n' +
      `  '${placeholderJpg.toString('base64')}';\n`,
  );
  console.log('✔  nowplaying-placeholder.jpg (512×512) + nowPlayingPlaceholderData.ts');

  console.log('\nAll source assets generated in src/assets/');
  console.log('Run "npx expo prebuild --clean" to sync into native ios/ and android/ directories.');
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
