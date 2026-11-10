import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DownloadBanner } from './DownloadBanner';
import { PlayerPhoneMini } from './player/PlayerPhoneMini';
import { PlayerTabletPortraitMini } from './player/PlayerTabletPortraitMini';
import { useIsTabletPortrait } from '../hooks/useIsTabletPortrait';
import { useLayoutMode } from '../hooks/useLayoutMode';
import { authStore } from '../store/authStore';
import { musicCacheStore } from '../store/musicCacheStore';
import { playerStore } from '../store/playerStore';

/**
 * Single shared bottom-chrome stack rendered both inside the tabs
 * `renderTabBar` callback and as a footer on every non-tab Stack screen.
 *
 * Composes `<DownloadBanner />` above `<PlayerPhoneMini />` with **independent**
 * visibility:
 *   - banner is visible whenever the download queue has any
 *     downloading/queued/error rows;
 *   - PlayerPhoneMini is visible whenever there is a current track AND the
 *     layout is compact (wide layouts don't show the mini player).
 *
 * Either piece can be on while the other is off — e.g. a download
 * starts before the user plays anything, or the user clears the play
 * queue while a download is in flight.
 *
 * `withSafeAreaPadding` controls whether the wrapper applies
 * `paddingBottom: insets.bottom`. The tabs layout's `BottomTabBar`
 * already provides safe-area handling for its own children, so the tabs
 * call passes `false` (the default). Non-tab Stack screens render this
 * as the last layout-flow element, so they pass `true`.
 */
interface BottomChromeProps {
  withSafeAreaPadding?: boolean;
  /** Suppresses the mini player (the download banner is unaffected). */
  hideMiniPlayer?: boolean;
}

export function BottomChrome({
  withSafeAreaPadding = false,
  hideMiniPlayer = false,
}: BottomChromeProps = {}) {
  const isWide = useLayoutMode() === 'wide';
  const isTabletPortrait = useIsTabletPortrait();
  const isLoggedIn = authStore((s) => s.isLoggedIn);
  const hasCurrentTrack = playerStore((s) => s.currentTrack !== null);
  // Mirrors `DownloadBanner`'s own filter so the two can't drift. Counts
  // only the rows the download-queue screen actually displays — `complete`
  // ghost rows must not keep the chrome on screen.
  const hasDownloads = musicCacheStore((s) =>
    s.downloadQueue.some(
      (q) => q.status === 'downloading' || q.status === 'queued' || q.status === 'error',
    ),
  );
  const insets = useSafeAreaInsets();

  if (!isLoggedIn) return null;
  // On wide layouts the mini player never renders, so the chrome only has a
  // reason to mount when there are downloads.
  const showMini = !isWide && hasCurrentTrack && !hideMiniPlayer;
  if (!showMini && !hasDownloads) return null;

  return (
    <View
      style={[
        styles.wrapper,
        withSafeAreaPadding ? { paddingBottom: insets.bottom } : null,
      ]}
    >
      {hasDownloads && <DownloadBanner />}
      {showMini && (
        isTabletPortrait ? <PlayerTabletPortraitMini /> : <PlayerPhoneMini />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
});
