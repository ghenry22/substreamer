import { type ReactNode, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../hooks/useTheme';

const SLIDE_DURATION = 350;
const SLIDE_EASING = Easing.out(Easing.cubic);

interface SplitLayoutProps {
  /** Main content (left pane, ~2/3 width) */
  main: ReactNode;
  /** Side panel content (right pane, ~1/3 width). When null, main takes full width. */
  panel: ReactNode | null;
  /** When false, panel show/hide is instant (no animation). Default true. */
  animate?: boolean;
}

export function SplitLayout({ main, panel, animate = true }: SplitLayoutProps) {
  const { colors } = useTheme();
  const hasPanel = panel !== null;
  const panelProgress = useSharedValue(hasPanel ? 1 : 0);

  // Keep a ref to the last non-null panel so we can render it during exit animation
  const lastPanelRef = useRef<ReactNode>(null);
  const [renderPanel, setRenderPanel] = useState(hasPanel);

  if (panel !== null) {
    lastPanelRef.current = panel;
  }

  useEffect(() => {
    if (hasPanel) {
      setRenderPanel(true);
      cancelAnimation(panelProgress);
      if (animate) {
        panelProgress.value = withTiming(1, {
          duration: SLIDE_DURATION,
          easing: SLIDE_EASING,
        });
      } else {
        panelProgress.value = 1;
      }
    } else {
      cancelAnimation(panelProgress);
      if (animate) {
        panelProgress.value = withTiming(0, {
          duration: SLIDE_DURATION,
          easing: SLIDE_EASING,
        }, (finished) => {
          if (finished) {
            runOnJS(setRenderPanel)(false);
          }
        });
      } else {
        panelProgress.value = 0;
        setRenderPanel(false);
      }
    }
  }, [hasPanel, animate, panelProgress]);

  const panelStyle = useAnimatedStyle(() => ({
    flex: panelProgress.value,
    opacity: panelProgress.value,
    overflow: 'hidden' as const,
  }));

  const dividerStyle = useAnimatedStyle(() => ({
    opacity: panelProgress.value,
    width: panelProgress.value > 0 ? StyleSheet.hairlineWidth : 0,
  }));

  return (
    <View style={styles.container}>
      <View style={styles.main}>{main}</View>
      {renderPanel && (
        <>
          <Animated.View style={[{ backgroundColor: colors.border }, dividerStyle]} />
          <Animated.View style={panelStyle}>
            {panel ?? lastPanelRef.current}
          </Animated.View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
  },
  main: {
    flex: 3,
  },
});
