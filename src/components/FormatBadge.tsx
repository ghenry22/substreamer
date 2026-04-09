/**
 * FormatBadge – quality-coloured pill showing the effective audio format.
 *
 * Displays the codec name (e.g. "FLAC", "MP3 320"), a quality-tier
 * glyph (infinity for lossless, waveform for lossy), and an optional
 * "HR" micro-pill for hi-res content (≥24-bit/96kHz).
 */

import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { type EffectiveFormat } from '../types/audio';
import {
  classifyAudio,
  formatAudioDetails,
  getQualityColor,
  type AudioQualityTier,
} from '../utils/audioFormat';
import { hexWithAlpha } from '../utils/colors';

/* ------------------------------------------------------------------ */
/*  SVG Glyphs                                                        */
/* ------------------------------------------------------------------ */

const GLYPH_SIZE = 14;

function LosslessGlyph({ color }: { color: string }) {
  return (
    <Svg width={GLYPH_SIZE} height={GLYPH_SIZE} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 12c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4m8 0c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4-4-1.79-4-4Z"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function LossyGlyph({ color }: { color: string }) {
  return (
    <Svg width={GLYPH_SIZE} height={GLYPH_SIZE} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export const FormatBadge = memo(function FormatBadge({ format }: { format: EffectiveFormat }) {
  const tier = useMemo(() => classifyAudio(format), [format]);
  const details = useMemo(() => formatAudioDetails(format), [format]);
  const color = getQualityColor(tier);
  const bgColor = hexWithAlpha(color, 0.12);
  const isLossless = tier === 'lossless' || tier === 'hires';

  return (
    <View style={[styles.badge, { backgroundColor: bgColor }]}>
      {isLossless ? <LosslessGlyph color={color} /> : <LossyGlyph color={color} />}
      <Text style={[styles.label, { color }]}>{details}</Text>
      {tier === 'hires' && <HiResPill color={color} />}
    </View>
  );
});

function HiResPill({ color }: { color: string }) {
  return (
    <View style={[styles.hiResPill, { backgroundColor: color }]}>
      <Text style={styles.hiResLabel}>HR</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                            */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 5,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  hiResPill: {
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginLeft: 2,
  },
  hiResLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});
