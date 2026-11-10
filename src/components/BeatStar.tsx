import { memo, useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import { usePlaybackState } from '../hooks/usePlaybackState';
import { playerStore } from '../store/playerStore';
import { mixHexColors } from '../utils/colors';

interface BeatStarProps {
  /** Track tint (cover palette colour). */
  color: string;
  /** Tempo in beats per minute; an estimate is used when the server has none. */
  bpm: number;
  /** Vertical centre of the star as a fraction of screen height. */
  centerY?: number;
}

const MIN_BPM = 60;
const MAX_BPM = 200;

/** 4-point sparkle with concave sides, centred in a (2r x 2r) box. */
function sparklePath(r: number): string {
  const c = r * 0.14;
  return (
    `M${r} 0 Q${r + c} ${r - c} ${2 * r} ${r} Q${r + c} ${r + c} ${r} ${2 * r} ` +
    `Q${r - c} ${r + c} 0 ${r} Q${r - c} ${r - c} ${r} 0 Z`
  );
}

/**
 * A shining star behind the hero that flashes on the beat, tinted with the track colour.
 *
 * There is no audio analysis in the player, so the pulse is derived from the playback
 * position and the tempo: it stays locked to the song through pauses and seeks, but it
 * follows the tempo, not the actual loudness of each instrument.
 */
export const BeatStar = memo(function BeatStar({ color, bpm, centerY = 0.38 }: BeatStarProps) {
  const { width, height } = useWindowDimensions();
  const { isPlaying } = usePlaybackState();
  const position = playerStore((s) => s.position);

  const tempo = Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
  const syncPos = useSharedValue(0);
  const syncStamp = useSharedValue(0);
  const playing = useSharedValue(0);
  const tempoSv = useSharedValue(tempo);
  const pulse = useSharedValue(0);

  useEffect(() => {
    syncPos.value = position;
    syncStamp.value = Date.now();
    playing.value = isPlaying ? 1 : 0;
  }, [position, isPlaying, syncPos, syncStamp, playing]);

  useEffect(() => {
    tempoSv.value = tempo;
  }, [tempo, tempoSv]);

  useFrameCallback((frame) => {
    const dt = frame.timeSincePreviousFrame ?? 16;
    const pos = syncPos.value + (playing.value ? (Date.now() - syncStamp.value) / 1000 : 0);
    const phase = pos * (tempoSv.value / 60);
    const frac = phase - Math.floor(phase);
    // Sharp attack on the beat, quick decay, and a softer off-beat flash.
    const offFrac = (frac + 0.5) % 1;
    const kick = Math.exp(-frac * 5.5);
    const hat = 0.35 * Math.exp(-offFrac * 9);
    // Slow swell so bars breathe instead of repeating identically.
    const swell = 0.8 + 0.2 * Math.sin(pos * 0.9);
    const target = playing.value ? Math.min(1, (kick + hat) * swell) : 0.12;
    pulse.value =
      target > pulse.value ? target : target + (pulse.value - target) * Math.exp(-dt / 120);
  });

  const size = width * 1.15;
  const r = size / 2;
  const path = useMemo(() => sparklePath(r), [r]);
  const core = useMemo(() => mixHexColors(color, '#FFFFFF', 0.65), [color]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.25 + 0.5 * pulse.value,
    transform: [{ scale: 0.8 + 0.4 * pulse.value }],
  }));
  const mainStyle = useAnimatedStyle(() => ({
    opacity: 0.3 + 0.7 * pulse.value,
    transform: [{ scale: 0.7 + 0.55 * pulse.value }],
  }));
  const diagStyle = useAnimatedStyle(() => ({
    opacity: 0.15 + 0.6 * pulse.value,
    transform: [{ rotate: `${45 + 8 * pulse.value}deg` }, { scale: 0.45 + 0.4 * pulse.value }],
  }));

  return (
    <View
      pointerEvents="none"
      style={[styles.box, { width: size, height: size, left: (width - size) / 2, top: height * centerY - r }]}
    >
      <Animated.View renderToHardwareTextureAndroid style={[StyleSheet.absoluteFill, glowStyle]}>
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id="beat-glow" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0" stopColor={color} stopOpacity="0.55" />
              <Stop offset="0.45" stopColor={color} stopOpacity="0.18" />
              <Stop offset="1" stopColor={color} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Path
            d={`M0 ${r} a${r} ${r} 0 1 0 ${size} 0 a${r} ${r} 0 1 0 -${size} 0 Z`}
            fill="url(#beat-glow)"
          />
        </Svg>
      </Animated.View>
      <Animated.View renderToHardwareTextureAndroid style={[StyleSheet.absoluteFill, diagStyle]}>
        <Svg width={size} height={size}>
          <Path d={path} fill={color} fillOpacity={0.55} />
        </Svg>
      </Animated.View>
      <Animated.View renderToHardwareTextureAndroid style={[StyleSheet.absoluteFill, mainStyle]}>
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id="beat-star" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="1" />
              <Stop offset="0.12" stopColor={core} stopOpacity="0.95" />
              <Stop offset="0.6" stopColor={color} stopOpacity="0.55" />
              <Stop offset="1" stopColor={color} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Path d={path} fill="url(#beat-star)" />
        </Svg>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
  },
});
