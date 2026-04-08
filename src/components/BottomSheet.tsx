import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../hooks/useTheme';

const BACKDROP_OPACITY = 0.4;
const DISMISS_DISTANCE_RATIO = 0.35;
const DISMISS_VELOCITY = 800;
const DEFAULT_HEIGHT = 600;
const ENTRY_SPRING = { damping: 28, stiffness: 160, mass: 0.8 };
const EXIT_DURATION = 250;
const BACKDROP_DURATION = 300;

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  closeable?: boolean;
  maxHeight?: DimensionValue;
  children: React.ReactNode;
}

export function BottomSheet({
  visible,
  onClose,
  closeable = true,
  maxHeight,
  children,
}: BottomSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [internalVisible, setInternalVisible] = useState(false);
  const isClosing = useRef(false);

  const translateY = useSharedValue(DEFAULT_HEIGHT);
  const backdropOpacity = useSharedValue(0);
  // Shared values so worklet gesture callbacks can read them
  const sheetHeightSV = useSharedValue(DEFAULT_HEIGHT);
  const closeableSV = useSharedValue(closeable);

  // Keep closeableSV in sync with prop
  useEffect(() => {
    closeableSV.value = closeable;
  }, [closeable, closeableSV]);

  const finishClose = useCallback(() => {
    setInternalVisible(false);
    isClosing.current = false;
    onClose();
  }, [onClose]);

  const markClosing = useCallback(() => {
    isClosing.current = true;
  }, []);

  const playEntryAnimation = useCallback(() => {
    const height = sheetHeightSV.value || DEFAULT_HEIGHT;
    translateY.value = height;
    backdropOpacity.value = 0;
    translateY.value = withSpring(0, ENTRY_SPRING);
    backdropOpacity.value = withTiming(BACKDROP_OPACITY, { duration: BACKDROP_DURATION });
  }, [translateY, backdropOpacity, sheetHeightSV]);

  const playExitAnimation = useCallback(() => {
    if (isClosing.current) return;
    isClosing.current = true;

    const height = sheetHeightSV.value || DEFAULT_HEIGHT;
    translateY.value = withTiming(height, { duration: EXIT_DURATION });
    backdropOpacity.value = withTiming(0, { duration: EXIT_DURATION }, (finished) => {
      if (finished) {
        runOnJS(finishClose)();
      }
    });
  }, [translateY, backdropOpacity, sheetHeightSV, finishClose]);

  // visible prop → true: push sheet off-screen before mounting Modal
  useEffect(() => {
    if (visible && !internalVisible) {
      isClosing.current = false;
      translateY.value = sheetHeightSV.value || DEFAULT_HEIGHT;
      backdropOpacity.value = 0;
      setInternalVisible(true);
    }
  }, [visible, internalVisible, translateY, backdropOpacity, sheetHeightSV]);

  // visible prop → false while shown: close immediately (no exit animation).
  // Exit animations only play for user-initiated dismissals (swipe, backdrop tap,
  // back button) which call playExitAnimation directly. Programmatic closes must
  // be instant so the next sheet can mount without two Modals overlapping.
  //
  // U8 (react-native-screens iOS Fabric Yoga SIGABRT, software-mansion/react-native-screens#3786):
  // defer setInternalVisible(false) by one frame. Action handlers commonly call
  // both `setSomeParentState(...)` and `hide()` in the same tick. Tearing down
  // the native Modal in the same frame as the parent re-render races Yoga and
  // crashes on iOS 26 Fabric. Letting the parent commit + paint first then
  // unmounting avoids the collision and is invisible to the user.
  useEffect(() => {
    if (!visible && internalVisible && !isClosing.current) {
      const handle = requestAnimationFrame(() => {
        if (isClosing.current) return;
        translateY.value = 0;
        backdropOpacity.value = 0;
        setInternalVisible(false);
      });
      return () => cancelAnimationFrame(handle);
    }
  }, [visible, internalVisible, translateY, backdropOpacity]);

  const handleModalShow = useCallback(() => {
    playEntryAnimation();
  }, [playEntryAnimation]);

  const handleBackdropPress = useCallback(() => {
    if (!closeable) return;
    playExitAnimation();
  }, [closeable, playExitAnimation]);

  const handleRequestClose = useCallback(() => {
    if (!closeable) return;
    playExitAnimation();
  }, [closeable, playExitAnimation]);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    sheetHeightSV.value = e.nativeEvent.layout.height;
  }, [sheetHeightSV]);

  const panGesture = Gesture.Pan()
    .activeOffsetY(10)
    .onUpdate((e) => {
      'worklet';
      if (!closeableSV.value) return;
      const clamped = Math.max(0, e.translationY);
      translateY.value = clamped;

      const height = sheetHeightSV.value || DEFAULT_HEIGHT;
      const progress = 1 - clamped / height;
      backdropOpacity.value = BACKDROP_OPACITY * Math.max(0, Math.min(1, progress));
    })
    .onEnd((e) => {
      'worklet';
      if (!closeableSV.value) return;

      const height = sheetHeightSV.value || DEFAULT_HEIGHT;
      const shouldDismiss =
        e.translationY > height * DISMISS_DISTANCE_RATIO ||
        e.velocityY > DISMISS_VELOCITY;

      if (shouldDismiss) {
        translateY.value = withTiming(height, { duration: EXIT_DURATION });
        backdropOpacity.value = withTiming(0, { duration: EXIT_DURATION }, (finished) => {
          if (finished) {
            runOnJS(finishClose)();
          }
        });
        runOnJS(markClosing)();
      } else {
        translateY.value = withSpring(0, ENTRY_SPRING);
        backdropOpacity.value = withTiming(BACKDROP_OPACITY, { duration: 200 });
      }
    });

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    // toFixed(4) prevents scientific notation (e.g. 3.5e-8) which
    // Reanimated's color parser cannot handle.
    backgroundColor: `rgba(0,0,0,${backdropOpacity.value.toFixed(4)})`,
  }));

  if (!internalVisible) return null;

  return (
    <Modal
      visible={internalVisible}
      transparent
      animationType="none"
      onShow={handleModalShow}
      onRequestClose={handleRequestClose}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={styles.gestureRoot}>
        {/* Animated backdrop */}
        <Animated.View style={[styles.backdropFill, backdropAnimatedStyle]}>
          <Pressable testID="bottom-sheet-backdrop" style={styles.backdropPressable} onPress={handleBackdropPress} />
        </Animated.View>

        {/* Sheet */}
        <Animated.View
          style={[
            styles.sheet,
            maxHeight != null && { maxHeight },
            {
              backgroundColor: colors.card,
              paddingBottom: Math.max(insets.bottom, 16),
            },
            sheetAnimatedStyle,
          ]}
          onLayout={handleLayout}
        >
          {/* Handle — gesture scoped here so it doesn't block ScrollView */}
          <GestureDetector gesture={panGesture}>
            <View style={styles.handleContainer}>
              <View style={[styles.handle, { backgroundColor: colors.primary }]} />
            </View>
          </GestureDetector>

          {children}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  backdropFill: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  backdropPressable: {
    flex: 1,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    zIndex: 1,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  handleContainer: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
});
