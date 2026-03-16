/**
 * SwipeableRow – drop-in swipeable row built on ReanimatedSwipeable.
 *
 * Reveals action buttons behind the row when the user swipes left or right.
 * Each action appears as a colored circular disc with a white icon and label,
 * matching the iOS Mail style.
 *
 * Supports an optional "full swipe" mode (like Apple Mail) where swiping past
 * a threshold automatically triggers the outermost action without requiring a tap.
 * For swipe-right this is the first action (index 0, left edge); for swipe-left
 * this is the last action (rightmost, screen edge).
 *
 * - Swipe physics, snap-back, and alignment handled by the library
 * - Long press and tap handled via a Pressable wrapper
 * - Module-level `closeOpenRow()` export for scroll-to-close behaviour
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from '@/utils/haptics';
import { memo, useCallback, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useTheme } from '../hooks/useTheme';

/* ------------------------------------------------------------------ */
/*  Module-level: active row tracking                                  */
/* ------------------------------------------------------------------ */

interface SwipeableMethods {
  close: () => void;
  openLeft: () => void;
  openRight: () => void;
  reset: () => void;
}

let _activeRef: SwipeableMethods | null = null;

/**
 * Close whichever SwipeableRow is currently peeked open (if any).
 * Call from list `onScrollBeginDrag` so open rows close on scroll.
 */
export function closeOpenRow() {
  _activeRef?.close();
  _activeRef = null;
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SwipeAction {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  /** Text label displayed below the icon (e.g., "Queue", "Favorite"). */
  label?: string;
  onPress: () => void;
  /** When true the row is removed from the list after the action fires. */
  removesRow?: boolean;
}

export interface SwipeableRowProps {
  /** Actions revealed when swiping RIGHT (content moves right, buttons on left). */
  rightActions?: SwipeAction[];
  /** Actions revealed when swiping LEFT (content moves left, buttons on right). */
  leftActions?: SwipeAction[];
  /** Full swipe right auto-triggers the first rightAction. */
  enableFullSwipeRight?: boolean;
  /** Full swipe left auto-triggers the outermost (last) leftAction. */
  enableFullSwipeLeft?: boolean;
  /** Corner radius for the sliding content card (matches the row content's radius). */
  borderRadius?: number;
  /** Vertical spacing below the row, applied outside the rounded content area. */
  rowGap?: number;
  /** Background color shown at rest beneath children. Defaults to `colors.card` from the theme. Pass `'transparent'` to disable. */
  restingBackgroundColor?: string;
  /** Called when a long-press gesture activates. */
  onLongPress?: () => void;
  /** Called when the row is tapped. */
  onPress?: () => void;
  children: React.ReactNode;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const ACTION_WIDTH = 74;
const ICON_SIZE = 22;
const ICON_DISC_SIZE = 46;

/** Progress threshold beyond which a swipe counts as "full" (1.5x action panel width). */
const FULL_SWIPE_PROGRESS_THRESHOLD = 1.5;

/** Fallback timeout (ms) to close the row if onSwipeableOpen never fires. */
const FULL_SWIPE_CLOSE_TIMEOUT = 500;

/* ------------------------------------------------------------------ */
/*  SwipeableRow                                                       */
/* ------------------------------------------------------------------ */

export const SwipeableRow = memo(function SwipeableRow({
  rightActions = [],
  leftActions = [],
  enableFullSwipeRight = false,
  enableFullSwipeLeft = false,
  borderRadius = 16,
  rowGap = 0,
  restingBackgroundColor,
  onLongPress,
  onPress,
  children,
}: SwipeableRowProps) {
  const { colors } = useTheme();
  const effectiveRestingBg = restingBackgroundColor ?? colors.card;
  const swipeableRef = useRef<SwipeableMethods>(null);
  const isOpenRef = useRef(false);
  const pendingFullSwipeCloseRef = useRef(false);

  const hasRight = rightActions.length > 0;
  const hasLeft = leftActions.length > 0;

  // SharedValues for UI-thread operations (haptic, icon pop) – race-free
  const fullSwipeRightTriggered = useSharedValue(false);
  const fullSwipeLeftTriggered = useSharedValue(false);
  const dragProgress = useSharedValue(0);

  // JS refs for JS-thread reads (callbacks) – set via runOnJS to guarantee ordering
  const fullSwipeRightRef = useRef(false);
  const fullSwipeLeftRef = useRef(false);

  const setFullSwipeRight = useCallback((v: boolean) => {
    fullSwipeRightRef.current = v;
  }, []);

  const setFullSwipeLeft = useCallback((v: boolean) => {
    fullSwipeLeftRef.current = v;
  }, []);

  /* ---- Swipeable event handlers ---- */

  const handleOpenStartDrag = useCallback(() => {
    if (_activeRef && _activeRef !== swipeableRef.current) {
      _activeRef.close();
      _activeRef = null;
    }
  }, []);

  const handleSwipeableWillOpen = useCallback(
    (direction: 'left' | 'right') => {
      if (
        direction === 'right' &&
        enableFullSwipeRight &&
        fullSwipeRightRef.current
      ) {
        fullSwipeRightRef.current = false;
        rightActions[0]?.onPress();
        pendingFullSwipeCloseRef.current = true;
        setTimeout(() => {
          if (pendingFullSwipeCloseRef.current) {
            pendingFullSwipeCloseRef.current = false;
            swipeableRef.current?.close();
          }
        }, FULL_SWIPE_CLOSE_TIMEOUT);
        return;
      }
      if (
        direction === 'left' &&
        enableFullSwipeLeft &&
        fullSwipeLeftRef.current
      ) {
        fullSwipeLeftRef.current = false;
        leftActions[leftActions.length - 1]?.onPress();
        pendingFullSwipeCloseRef.current = true;
        setTimeout(() => {
          if (pendingFullSwipeCloseRef.current) {
            pendingFullSwipeCloseRef.current = false;
            swipeableRef.current?.close();
          }
        }, FULL_SWIPE_CLOSE_TIMEOUT);
      }
    },
    [enableFullSwipeRight, enableFullSwipeLeft, rightActions, leftActions],
  );

  const handleSwipeableOpen = useCallback(() => {
    if (pendingFullSwipeCloseRef.current) {
      pendingFullSwipeCloseRef.current = false;
      swipeableRef.current?.close();
      return;
    }
    isOpenRef.current = true;
    _activeRef = swipeableRef.current;
  }, []);

  const handleSwipeableClose = useCallback(() => {
    isOpenRef.current = false;
    fullSwipeRightRef.current = false;
    fullSwipeLeftRef.current = false;
    pendingFullSwipeCloseRef.current = false;
    if (_activeRef === swipeableRef.current) {
      _activeRef = null;
    }
  }, []);

  /* ---- Tap / long-press handlers ---- */

  const pressOpacity = useSharedValue(1);

  const handlePressIn = useCallback(() => {
    if (isOpenRef.current) return;
    pressOpacity.value = withTiming(0.7, { duration: 80 });
  }, [pressOpacity]);

  const handlePressOut = useCallback(() => {
    pressOpacity.value = withTiming(1, { duration: 150 });
  }, [pressOpacity]);

  const pressedStyle = useAnimatedStyle(() => ({
    opacity: pressOpacity.value,
  }));

  const swipeBgStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dragProgress.value, [0, 0.5, 1], [0, 1, 1], 'clamp'),
  }));

  const handlePress = useCallback(() => {
    if (isOpenRef.current) {
      swipeableRef.current?.close();
      return;
    }
    Haptics.selectionAsync();
    onPress?.();
  }, [onPress]);

  const handleLongPress = useCallback(() => {
    if (isOpenRef.current) {
      swipeableRef.current?.close();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    onLongPress?.();
  }, [onLongPress]);

  /* ---- Action panel render functions ---- */

  const hasFullSwipe =
    (enableFullSwipeRight && hasRight) || (enableFullSwipeLeft && hasLeft);
  const effectiveFriction = hasFullSwipe ? 1.5 : 2;
  const effectiveOvershootFriction = hasFullSwipe ? 1 : 8;

  // renderLeftActions = shown when swiping RIGHT = our rightActions
  // Outermost action is index 0 (left edge of screen).
  const renderLeftPanel = useCallback(
    (
      progress: SharedValue<number>,
      _translation: SharedValue<number>,
      methods: SwipeableMethods,
    ) => (
      <ActionPanel
        actions={rightActions}
        progress={progress}
        dragProgress={dragProgress}
        methods={methods}
        enableFullSwipe={enableFullSwipeRight}
        fullSwipeActionIndex={0}
        fullSwipeTriggered={fullSwipeRightTriggered}
        onFullSwipeChange={setFullSwipeRight}
      />
    ),
    [rightActions, dragProgress, enableFullSwipeRight, fullSwipeRightTriggered, setFullSwipeRight],
  );

  // renderRightActions = shown when swiping LEFT = our leftActions
  // Outermost action is the last index (right edge of screen).
  const renderRightPanel = useCallback(
    (
      progress: SharedValue<number>,
      _translation: SharedValue<number>,
      methods: SwipeableMethods,
    ) => (
      <ActionPanel
        actions={leftActions}
        progress={progress}
        dragProgress={dragProgress}
        methods={methods}
        enableFullSwipe={enableFullSwipeLeft}
        fullSwipeActionIndex={leftActions.length - 1}
        fullSwipeTriggered={fullSwipeLeftTriggered}
        onFullSwipeChange={setFullSwipeLeft}
      />
    ),
    [leftActions, dragProgress, enableFullSwipeLeft, fullSwipeLeftTriggered, setFullSwipeLeft],
  );

  const swipeContainerStyle = useMemo(
    () => ({
      backgroundColor: 'transparent' as const,
      marginBottom: rowGap || undefined,
    }),
    [rowGap],
  );

  const contentClipStyle = useMemo(
    () => ({ borderRadius, overflow: 'hidden' as const }),
    [borderRadius],
  );

  return (
    <ReanimatedSwipeable
      ref={swipeableRef as any}
      friction={effectiveFriction}
      overshootFriction={effectiveOvershootFriction}
      leftThreshold={40}
      rightThreshold={40}
      overshootLeft={hasRight}
      overshootRight={hasLeft}
      renderLeftActions={hasRight ? renderLeftPanel : undefined}
      renderRightActions={hasLeft ? renderRightPanel : undefined}
      onSwipeableOpenStartDrag={handleOpenStartDrag}
      onSwipeableWillOpen={handleSwipeableWillOpen}
      onSwipeableOpen={handleSwipeableOpen}
      onSwipeableClose={handleSwipeableClose}
      containerStyle={swipeContainerStyle}
    >
      <Pressable
        onPress={handlePress}
        onLongPress={onLongPress ? handleLongPress : undefined}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        delayLongPress={400}
      >
        <Animated.View style={[pressedStyle, contentClipStyle]}>
          {effectiveRestingBg !== 'transparent' && (
            <View style={[styles.swipeBg, { backgroundColor: effectiveRestingBg }]} />
          )}
          <Animated.View
            style={[styles.swipeBg, { backgroundColor: colors.inputBg }, swipeBgStyle]}
          />
          {children}
        </Animated.View>
      </Pressable>
    </ReanimatedSwipeable>
  );
});

/* ------------------------------------------------------------------ */
/*  ActionPanel – row of action buttons behind the swiped content      */
/* ------------------------------------------------------------------ */

interface ActionPanelProps {
  actions: SwipeAction[];
  progress: SharedValue<number>;
  dragProgress: SharedValue<number>;
  methods: SwipeableMethods;
  enableFullSwipe: boolean;
  /** Which action index receives the pop animation on full swipe. */
  fullSwipeActionIndex: number;
  fullSwipeTriggered: SharedValue<boolean>;
  onFullSwipeChange: (triggered: boolean) => void;
}

function ActionPanel({
  actions,
  progress,
  dragProgress,
  methods,
  enableFullSwipe,
  fullSwipeActionIndex,
  fullSwipeTriggered,
  onFullSwipeChange,
}: ActionPanelProps) {
  const iconPopScale = useSharedValue(1);

  useAnimatedReaction(
    () => progress.value,
    (current) => {
      dragProgress.value = current;
    },
  );

  useAnimatedReaction(
    () => progress.value,
    (current, previous) => {
      if (!enableFullSwipe) return;

      const prev = previous ?? 0;

      if (
        current >= FULL_SWIPE_PROGRESS_THRESHOLD &&
        prev < FULL_SWIPE_PROGRESS_THRESHOLD
      ) {
        fullSwipeTriggered.value = true;
        runOnJS(onFullSwipeChange)(true);
        runOnJS(Haptics.selectionAsync)();
        iconPopScale.value = withSequence(
          withTiming(1.35, { duration: 120 }),
          withTiming(1.22, { duration: 100 }),
          withTiming(1.35, { duration: 100 }),
          withTiming(1, { duration: 180 }),
        );
      } else if (
        current < FULL_SWIPE_PROGRESS_THRESHOLD &&
        prev >= FULL_SWIPE_PROGRESS_THRESHOLD
      ) {
        fullSwipeTriggered.value = false;
        runOnJS(onFullSwipeChange)(false);
      }
    },
  );

  return (
    <View style={styles.actionPanel}>
      {actions.map((action, index) => (
        <ActionButton
          key={index}
          action={action}
          progress={progress}
          methods={methods}
          popScale={enableFullSwipe && index === fullSwipeActionIndex ? iconPopScale : undefined}
        />
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  ActionButton – circular disc with icon + label                     */
/* ------------------------------------------------------------------ */

interface ActionButtonProps {
  action: SwipeAction;
  progress: SharedValue<number>;
  methods: SwipeableMethods;
  popScale?: SharedValue<number>;
}

const ActionButton = memo(function ActionButton({
  action,
  progress,
  methods,
  popScale,
}: ActionButtonProps) {
  const discStyle = useAnimatedStyle(() => {
    const baseScale = interpolate(
      progress.value,
      [0, 0.6, 1],
      [0.5, 1, 1],
      'clamp',
    );
    const extra = popScale ? popScale.value : 1;
    return {
      transform: [{ scale: baseScale * extra }],
      opacity: interpolate(progress.value, [0, 0.3, 1], [0, 1, 1], 'clamp'),
    };
  });

  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.3, 1], [0, 1, 1], 'clamp'),
  }));

  const handlePress = useCallback(() => {
    action.onPress();
    methods.close();
  }, [action, methods]);

  return (
    <Pressable onPress={handlePress} style={styles.actionButton}>
      <Animated.View
        style={[styles.iconDisc, { backgroundColor: action.color }, discStyle]}
      >
        <Ionicons name={action.icon} size={ICON_SIZE} color="#fff" />
      </Animated.View>
      {action.label != null && (
        <Animated.Text style={[styles.actionLabel, labelStyle]} numberOfLines={1}>
          {action.label}
        </Animated.Text>
      )}
    </Pressable>
  );
});

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  swipeBg: {
    ...StyleSheet.absoluteFillObject,
  },
  actionPanel: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButton: {
    width: ACTION_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 5,
  },
  iconDisc: {
    width: ICON_DISC_SIZE,
    height: ICON_DISC_SIZE,
    borderRadius: ICON_DISC_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
});
