import { memo, type ReactElement } from 'react';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { mixHexColors } from '../utils/colors';

export type GlyphName =
  | 'crown'
  | 'note'
  | 'sparkle'
  | 'headphones'
  | 'equalizer'
  | 'mic'
  | 'moon'
  | 'disc'
  | 'leaf'
  | 'shuffle';

interface GenreGlyphProps {
  name: GlyphName;
  color: string;
  size: number;
}

/** Soft glossy genre emblems drawn as vectors; gradient runs from a light top to the base colour. */
export const GenreGlyph = memo(function GenreGlyph({ name, color, size }: GenreGlyphProps) {
  const id = `gg-${name}-${color.slice(1)}`;
  const light = mixHexColors(color, '#FFFFFF', 0.55);
  const fill = `url(#${id})`;

  let shape: ReactElement;
  switch (name) {
    case 'crown':
      shape = (
        <>
          <Path d="M10 74 L14 34 L36 54 L50 24 L64 54 L86 34 L90 74 Z" fill={fill} />
          <Rect x="10" y="78" width="80" height="12" rx="6" fill={fill} />
          <Circle cx="14" cy="30" r="7" fill={fill} />
          <Circle cx="50" cy="19" r="7" fill={fill} />
          <Circle cx="86" cy="30" r="7" fill={fill} />
        </>
      );
      break;
    case 'note':
      shape = (
        <>
          <Path d="M33 26 L89 10 V32 L33 48 Z" fill={fill} />
          <Rect x="33" y="30" width="10" height="46" fill={fill} />
          <Rect x="79" y="16" width="10" height="46" fill={fill} />
          <Circle cx="29" cy="76" r="14" fill={fill} />
          <Circle cx="75" cy="62" r="14" fill={fill} />
        </>
      );
      break;
    case 'sparkle':
      shape = (
        <Path
          d="M50 2 C54 30 70 46 98 50 C70 54 54 70 50 98 C46 70 30 54 2 50 C30 46 46 30 50 2 Z"
          fill={fill}
        />
      );
      break;
    case 'headphones':
      shape = (
        <>
          <Path
            d="M20 62 V50 A30 30 0 0 1 80 50 V62"
            fill="none"
            stroke={fill}
            strokeWidth="10"
            strokeLinecap="round"
          />
          <Rect x="8" y="54" width="22" height="36" rx="10" fill={fill} />
          <Rect x="70" y="54" width="22" height="36" rx="10" fill={fill} />
        </>
      );
      break;
    case 'equalizer': {
      const cols = [3, 5, 4, 2];
      shape = (
        <>
          {cols.flatMap((count, c) =>
            Array.from({ length: count }, (_, r) => (
              <Rect
                key={`${c}-${r}`}
                x={6 + c * 24}
                y={86 - (r + 1) * 16}
                width="19"
                height="12"
                rx="3"
                fill={fill}
              />
            )),
          )}
        </>
      );
      break;
    }
    case 'mic':
      shape = (
        <>
          <Rect x="36" y="6" width="28" height="50" rx="14" fill={fill} />
          <Path
            d="M24 44 A26 26 0 0 0 76 44"
            fill="none"
            stroke={fill}
            strokeWidth="8"
            strokeLinecap="round"
          />
          <Rect x="46" y="70" width="8" height="16" fill={fill} />
          <Rect x="30" y="84" width="40" height="9" rx="4.5" fill={fill} />
        </>
      );
      break;
    case 'moon':
      shape = <Path d="M60 6 A44 44 0 1 0 94 66 A36 36 0 0 1 60 6 Z" fill={fill} />;
      break;
    case 'disc':
      shape = (
        <Path
          d="M6 50 a44 44 0 1 0 88 0 a44 44 0 1 0 -88 0 M38 50 a12 12 0 1 0 24 0 a12 12 0 1 0 -24 0 Z"
          fill={fill}
          fillRule="evenodd"
        />
      );
      break;
    case 'leaf':
      shape = <Path d="M14 86 C4 42 38 10 92 8 C94 62 62 94 14 86 Z" fill={fill} />;
      break;
    case 'shuffle':
    default:
      shape = (
        <>
          <Path
            d="M8 28 H28 C48 28 52 72 72 72 H80 M8 72 H28 C48 72 52 28 72 28 H80"
            fill="none"
            stroke={fill}
            strokeWidth="9"
            strokeLinecap="round"
          />
          <Path d="M76 14 L96 28 L76 42 Z" fill={fill} />
          <Path d="M76 58 L96 72 L76 86 Z" fill={fill} />
        </>
      );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={light} />
          <Stop offset="1" stopColor={color} />
        </LinearGradient>
      </Defs>
      {shape}
    </Svg>
  );
});
