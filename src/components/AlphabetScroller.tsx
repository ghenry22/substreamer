import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type ViewInstance,
} from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { selectionAsync } from '../utils/haptics';

const ALPHABET = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const MAX_LINE_HEIGHT = 20;
/** `fontSize: 10` glyphs start clipping below this. */
const MIN_LINE_HEIGHT = 12;

/**
 * Size the letter strip to the space it actually has. A fixed line height makes the
 * strip a fixed 540pt at 27 letters, and a shorter container centres it and lets both
 * ends spill outside — where `resolveLetterFromY` can never map to them, because it
 * divides the touch offset by the whole strip height while touches only reach the part
 * on screen. That silently costs the end letters, which are the most-used ones.
 */
export function fitStrip(
  containerHeight: number,
  letters: string[],
): { letters: string[]; lineHeight: number } {
  if (containerHeight <= 0 || letters.length === 0) {
    return { letters, lineHeight: MAX_LINE_HEIGHT };
  }
  const ideal = Math.floor(containerHeight / letters.length);
  if (ideal >= MAX_LINE_HEIGHT) return { letters, lineHeight: MAX_LINE_HEIGHT };
  if (ideal >= MIN_LINE_HEIGHT) return { letters, lineHeight: ideal };
  // Too short for every letter even at the smallest legible size (landscape phones).
  // Thin the strip rather than overflow it, keeping the last letter so Z stays reachable.
  const fits = Math.max(2, Math.floor(containerHeight / MIN_LINE_HEIGHT));
  const stride = Math.ceil(letters.length / fits);
  const thinned = letters.filter((_, i) => i % stride === 0);
  const last = letters[letters.length - 1];
  if (thinned[thinned.length - 1] !== last) thinned.push(last);
  return {
    letters: thinned,
    lineHeight: Math.min(MAX_LINE_HEIGHT, Math.floor(containerHeight / thinned.length)),
  };
}

interface AlphabetScrollerProps {
  /** Set of letters that have at least one matching item */
  activeLetters: Set<string>;
  /** Called when the user taps or drags to a letter */
  onLetterChange: (letter: string) => void;
  /** Extra top offset so the scroller sits below a transparent header */
  topInset?: number;
}

export const AlphabetScroller = memo(function AlphabetScroller({
  activeLetters,
  onLetterChange,
  topInset = 0,
}: AlphabetScrollerProps) {
  const { colors } = useTheme();
  // These refs track the *inner* letter strip, not the full-height outer container
  const stripHeight = useRef(0);
  const stripY = useRef(0);
  const lastLetter = useRef<string | null>(null);

  // Only show letters that have matching items
  const visibleLetters = useMemo(
    () => ALPHABET.filter((l) => activeLetters.has(l)),
    [activeLetters]
  );

  // Measured height of the outer container; 0 until the first layout.
  const [containerHeight, setContainerHeight] = useState(0);
  const { letters: shownLetters, lineHeight } = useMemo(
    () => fitStrip(containerHeight, visibleLetters),
    [containerHeight, visibleLetters],
  );

  // The hit mapping has to read the letters actually RENDERED, not every active one —
  // a thinned strip maps a touch to what the user can see.
  const visibleLettersRef = useRef(shownLetters);
  visibleLettersRef.current = shownLetters;

  const resolveLetterFromY = useCallback((pageY: number) => {
    const letters = visibleLettersRef.current;
    if (letters.length === 0 || stripHeight.current === 0) return null;
    const relativeY = pageY - stripY.current;
    const clampedY = Math.max(0, Math.min(relativeY, stripHeight.current));
    const index = Math.floor(
      (clampedY / stripHeight.current) * letters.length
    );
    return letters[Math.min(index, letters.length - 1)];
  }, []);

  const handleTouch = useCallback(
    (pageY: number) => {
      const letter = resolveLetterFromY(pageY);
      if (letter && letter !== lastLetter.current) {
        lastLetter.current = letter;
        selectionAsync();
        onLetterChange(letter);
      }
    },
    [resolveLetterFromY, onLetterChange]
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        handleTouch(evt.nativeEvent.pageY);
      },
      onPanResponderMove: (evt: GestureResponderEvent) => {
        handleTouch(evt.nativeEvent.pageY);
      },
      onPanResponderRelease: () => {
        lastLetter.current = null;
      },
      onPanResponderTerminate: () => {
        lastLetter.current = null;
      },
    })
  ).current;

  // Measure the inner letter strip (not the full-height outer container)
  const stripRef = useRef<ViewInstance>(null);
  const handleStripLayout = useCallback(() => {
    stripRef.current?.measureInWindow((_x, y, _w, h) => {
      stripY.current = y;
      stripHeight.current = h;
    });
  }, []);

  if (visibleLetters.length === 0) return null;

  return (
    <View
      style={[styles.container, topInset > 0 && { top: topInset }]}
      onLayout={(e) => setContainerHeight(e.nativeEvent.layout.height)}
      {...panResponder.panHandlers}
    >
      <View
        ref={stripRef}
        onLayout={handleStripLayout}
      >
        {shownLetters.map((letter) => (
          <Text
            key={letter}
            style={[styles.letter, { color: colors.primary, lineHeight }]}
          >
            {letter}
          </Text>
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 2,
    top: 0,
    bottom: 0,
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  letter: {
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
});
