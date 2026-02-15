/**
 * MarqueeText – a text component that auto-scrolls back and forth
 * when its content is too wide for the container.
 *
 * If the text fits, it renders as a normal single-line `<Text>`.
 * When it overflows, a ping-pong translateX animation reveals the
 * full content with pauses at each end.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  type LayoutChangeEvent,
  StyleSheet,
  Text,
  type TextProps,
  View,
} from 'react-native';

export interface MarqueeTextProps extends TextProps {
  /** Scroll speed in pixels per second. @default 40 */
  speed?: number;
  /** Pause duration at each end in milliseconds. @default 1500 */
  pauseDuration?: number;
  /** Delay before the first scroll begins in milliseconds. @default 2000 */
  initialDelay?: number;
}

export const MarqueeText = memo(function MarqueeText({
  children,
  style,
  speed = 40,
  pauseDuration = 1500,
  initialDelay = 2000,
  ...rest
}: MarqueeTextProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);

  const shouldScroll = textWidth > 0 && containerWidth > 0 && textWidth > containerWidth;
  const scrollDistance = shouldScroll ? textWidth - containerWidth : 0;

  const handleContainerLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);

  const handleTextLayout = useCallback((e: LayoutChangeEvent) => {
    setTextWidth(e.nativeEvent.layout.width);
  }, []);

  // Stable key that changes whenever the text content changes.
  const childrenKey = typeof children === 'string' ? children : JSON.stringify(children);

  // Snap back to the start position when content changes.
  // NOTE: do NOT reset textWidth here – onLayout fires before this
  // effect and would be clobbered, preventing the animation from
  // ever starting on subsequent tracks.
  useEffect(() => {
    translateX.setValue(0);
  }, [childrenKey, translateX]);

  // Run the ping-pong animation.
  // Include childrenKey so the animation restarts for every new track,
  // even if shouldScroll / scrollDistance happen to be identical.
  useEffect(() => {
    if (!shouldScroll) {
      translateX.setValue(0);
      return;
    }

    const scrollDuration = (scrollDistance / speed) * 1000;

    const loop = Animated.loop(
      Animated.sequence([
        // Initial pause
        Animated.delay(initialDelay),
        // Scroll left to reveal end
        Animated.timing(translateX, {
          toValue: -scrollDistance,
          duration: scrollDuration,
          useNativeDriver: true,
        }),
        // Pause at the end
        Animated.delay(pauseDuration),
        // Scroll back to start
        Animated.timing(translateX, {
          toValue: 0,
          duration: scrollDuration,
          useNativeDriver: true,
        }),
        // Pause at the start before repeating
        Animated.delay(pauseDuration),
      ]),
    );

    animationRef.current = loop;
    loop.start();

    return () => {
      loop.stop();
      animationRef.current = null;
    };
  }, [shouldScroll, scrollDistance, speed, pauseDuration, initialDelay, translateX, childrenKey]);

  // Use measured text width when available, otherwise a large value
  // so the text never wraps. This avoids a flash of "..." truncation
  // before measurement completes.
  const innerWidth = textWidth > 0 ? textWidth : 10000;

  return (
    <View style={styles.container} onLayout={handleContainerLayout} pointerEvents="none">
      {/*
        The inner Animated.View is always set wide enough for the full
        text so it never wraps. The outer container clips via
        overflow: 'hidden' – no numberOfLines or ellipsis needed.
      */}
      <Animated.View
        style={[
          { width: innerWidth },
          shouldScroll ? { transform: [{ translateX }] } : undefined,
        ]}
      >
        <Text {...rest} style={style}>
          {children}
        </Text>
      </Animated.View>

      {/*
        Hidden text for measuring the full, unwrapped width.
        Placed inside a very wide wrapper so it never wraps at the
        container boundary – onLayout will report the true text width.
      */}
      <View style={styles.hiddenWrapper} pointerEvents="none">
        <Text
          key={childrenKey}
          {...rest}
          style={[style, styles.hiddenText]}
          onLayout={handleTextLayout}
        >
          {children}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  hiddenWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    // Very large width so the text never wraps – allows onLayout to
    // report the true single-line width of the text content.
    width: 10000,
    opacity: 0,
  },
  hiddenText: {
    // Prevent the text from stretching to fill the wide wrapper.
    // alignSelf: 'flex-start' makes it size to its actual content
    // width so onLayout reports the true text measurement.
    alignSelf: 'flex-start',
  },
});
