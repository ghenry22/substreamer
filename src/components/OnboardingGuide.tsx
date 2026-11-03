import Ionicons from "@react-native-vector-icons/ionicons/static";
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListViewToken,
} from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { onboardingStore } from '../store/onboardingStore';

import type { IoniconsName } from '../utils/iconNames';
/* ------------------------------------------------------------------ */
/*  Slide data                                                         */
/* ------------------------------------------------------------------ */

interface Slide {
  icon: IoniconsName;
  headlineKey: string;
  bodyKey: string;
}

const SLIDES: Slide[] = [
  {
    icon: 'swap-horizontal-outline',
    headlineKey: 'onboardingSwipeHeadline',
    bodyKey: 'onboardingSwipeBody',
  },
  {
    icon: 'cloud-offline-outline',
    headlineKey: 'onboardingOfflineHeadline',
    bodyKey: 'onboardingOfflineBody',
  },
  {
    icon: 'settings-outline',
    headlineKey: 'onboardingCustomiseHeadline',
    bodyKey: 'onboardingCustomiseBody',
  },
];

/**
 * Android-only extra slide: points users to Settings → Background Playback if
 * music stops when the screen is off / the app is backgrounded. Surfaces the
 * battery-optimization exemption broadly (Fire OS users also get a one-time
 * prompt on first play; this covers all Android). Not shown on iOS, which has
 * no equivalent setting.
 */
const ANDROID_BACKGROUND_SLIDE: Slide = {
  icon: 'musical-notes-outline',
  headlineKey: 'onboardingBackgroundHeadline',
  bodyKey: 'onboardingBackgroundBody',
};

/* ------------------------------------------------------------------ */
/*  Dot indicator                                                      */
/* ------------------------------------------------------------------ */

const Dots = memo(function Dots({
  count,
  activeIndex,
  activeColor,
  inactiveColor,
}: {
  count: number;
  activeIndex: number;
  activeColor: string;
  inactiveColor: string;
}) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            {
              backgroundColor: i === activeIndex ? activeColor : inactiveColor,
              width: i === activeIndex ? 24 : 8,
            },
          ]}
        />
      ))}
    </View>
  );
});

/* ------------------------------------------------------------------ */
/*  OnboardingGuide                                                    */
/* ------------------------------------------------------------------ */

const CARD_HORIZONTAL_MARGIN = 32;
const CARD_MAX_WIDTH = 480;

export const OnboardingGuide = memo(function OnboardingGuide() {
  const { t } = useTranslation();
  const visible = onboardingStore((s) => s.visible);
  const { colors } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const listRef = useRef<FlatList<Slide>>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const cardWidth = Math.min(screenWidth - CARD_HORIZONTAL_MARGIN * 2, CARD_MAX_WIDTH);
  const slideWidth = cardWidth;

  // Append the background-playback slide on Android only.
  const slides = useMemo(
    () => (Platform.OS === 'android' ? [...SLIDES, ANDROID_BACKGROUND_SLIDE] : SLIDES),
    [],
  );

  const handleDismiss = useCallback(() => {
    onboardingStore.getState().dismiss();
    setActiveIndex(0);
  }, []);

  const handleNext = useCallback(() => {
    if (activeIndex < slides.length - 1) {
      listRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
    } else {
      handleDismiss();
    }
  }, [activeIndex, handleDismiss, slides.length]);

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ListViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    }
  ).current;

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: slideWidth,
      offset: slideWidth * index,
      index,
    }),
    [slideWidth],
  );

  const renderItem = useCallback(
    ({ item }: { item: Slide }) => (
      <View style={[styles.slide, { width: slideWidth }]}>
        <View style={[styles.iconCircle, { backgroundColor: colors.primary + '18' }]}>
          <Ionicons name={item.icon} size={48} color={colors.primary} />
        </View>
        <Text style={[styles.headline, { color: colors.textPrimary }]}>
          {t(item.headlineKey)}
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {t(item.bodyKey)}
        </Text>
      </View>
    ),
    [slideWidth, colors.primary, colors.textPrimary, colors.textSecondary, t],
  );

  const keyExtractor = useCallback((_: Slide, index: number) => String(index), []);

  const isLastSlide = activeIndex === slides.length - 1;

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.card, width: cardWidth }]}>
          {/* Skip button */}
          <Pressable
            onPress={handleDismiss}
            hitSlop={12}
            style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}
          >
            <Text style={[styles.skipText, { color: colors.textSecondary }]}>{t('skip')}</Text>
          </Pressable>

          {/* Slides — uses RN FlatList deliberately (bounded 4-slide static
              carousel). The project-wide rule is FlashList v2 everywhere, but
              the virtualization win is zero here and FlashList's recycling
              doesn't pair cleanly with horizontal paging on a fixed list. See
              .claude/rules/react-components.md for the documented carveout. */}
          <FlatList
            ref={listRef}
            data={slides}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            bounces={false}
            getItemLayout={getItemLayout}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            scrollEventThrottle={16}
            style={styles.slideList}
          />

          {/* Dots */}
          <Dots
            count={slides.length}
            activeIndex={activeIndex}
            activeColor={colors.primary}
            inactiveColor={colors.border}
          />

          {/* Next / Get Started button */}
          <Pressable
            onPress={handleNext}
            style={({ pressed }) => [
              styles.nextButton,
              { backgroundColor: colors.primary },
              pressed && styles.nextButtonPressed,
            ]}
          >
            <Text style={styles.nextButtonText}>
              {isLastSlide ? t('getStarted') : t('next')}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
});

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    borderRadius: 24,
    paddingTop: 16,
    paddingBottom: 28,
    overflow: 'hidden',
  },
  slideList: {
    flexGrow: 0,
  },
  skipButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  skipText: {
    fontSize: 16,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.6,
  },
  slide: {
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 24,
    alignItems: 'center',
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  headline: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  nextButton: {
    marginHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  nextButtonPressed: {
    opacity: 0.85,
  },
  nextButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
