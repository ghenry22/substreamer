import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n/i18n';


import { BottomSheet } from './BottomSheet';
import { CachedImage } from './CachedImage';
import { useTheme } from '../hooks/useTheme';
import { syncCachedItemTracks } from '../services/musicCacheService';
import {
  addToPlaylist,
  createNewPlaylist,
  getAlbum,
} from '../services/subsonicService';
import {
  addToPlaylistStore,
  type AddToPlaylistTarget,
} from '../store/addToPlaylistStore';
import { musicCacheStore } from '../store/musicCacheStore';
import { playlistDetailStore } from '../store/playlistDetailStore';
import { playlistLibraryStore } from '../store/playlistLibraryStore';
import { processingOverlayStore } from '../store/processingOverlayStore';
import { layoutPreferencesStore } from '@/store/layoutPreferencesStore';

import type { Playlist, PlaylistWithSongs } from '../services/subsonicService';

const CONTENT_DELAY_MS = 750;
const CONTENT_ANIMATE_DURATION = 1000;
const SPINNER_HEIGHT = 48;

/**
 * Resolve the song IDs to add from a target.
 * For songs this is immediate; for albums we fetch the full track list.
 */
async function resolveSongIds(target: AddToPlaylistTarget): Promise<string[] | null> {
  if (target.type === 'song') return [target.item.id];
  if (target.type === 'queue') {
    if (target.songs.length === 0) return null;
    return target.songs.map((s) => s.id);
  }
  const full = await getAlbum(target.item.id);
  if (!full?.song?.length) return null;
  return full.song.map((s) => s.id);
}

function getTargetCoverArt(target: AddToPlaylistTarget): string | undefined {
  if (target.type === 'song') return target.item.coverArt;
  if (target.type === 'album') return target.item.coverArt;
  return target.songs[0]?.coverArt;
}

function getSubtitleText(target: AddToPlaylistTarget, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (target.type === 'song') {
    const title = target.item.title ?? t('unknownSong');
    const artist = target.item.artist ?? t('unknownArtist');
    return `${title} — ${artist}`;
  }
  if (target.type === 'queue') {
    const count = target.songs.length;
    return t('tracksFromQueue', { count });
  }
  const name = target.item.name ?? t('unknownAlbum');
  const artist = target.item.artist ?? t('unknownArtist');
  return `${name} — ${artist}`;
}

export function AddToPlaylistSheet() {
  const visible = addToPlaylistStore((s) => s.visible);
  const target = addToPlaylistStore((s) => s.target);
  const hide = addToPlaylistStore((s) => s.hide);
  const playlists = playlistLibraryStore((s) => s.playlists);
  const playlistsLoading = playlistLibraryStore((s) => s.loading);
  const playlistsFetchError = playlistLibraryStore((s) => s.error);
  const showSongInPlaylist = layoutPreferencesStore((s) => s.showSongInPlaylist);

  const { colors } = useTheme();
  const { t } = useTranslation();

  // Animate content reveal in two phases:
  // Phase 1 (entry animation): show spinner at a compact height.
  // Phase 2 (after delay): mount the real content off-screen to measure it,
  //   then animate the container height from SPINNER_HEIGHT → measured height
  //   and fade the content in simultaneously.
  // Phase: 'loading' → 'measuring' → 'ready'
  // 'loading': spinner shown, compact height
  // 'measuring': content mounted off-screen to capture its height
  // 'ready': height + opacity animating in
  const [phase, setPhase] = useState<'loading' | 'measuring' | 'ready'>('loading');
  const hasMeasured = useRef(false);
  const animatedHeight = useSharedValue(SPINNER_HEIGHT);
  const contentOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setPhase('loading');
      hasMeasured.current = false;
      animatedHeight.value = SPINNER_HEIGHT;
      contentOpacity.value = 0;
      const timer = setTimeout(() => {
        if (showSongInPlaylist === "show") {
          playlistLibraryStore.getState().fetchAllPlaylistsWithSongs();
        } else {
          playlistLibraryStore.getState().fetchAllPlaylists();
        }
        setPhase('measuring');
      }, CONTENT_DELAY_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [visible, animatedHeight, contentOpacity]);

  const transitionToReady = useCallback(() => {
    setPhase('ready');
  }, []);

  const handleContentLayout = useCallback((e: LayoutChangeEvent) => {
    if (hasMeasured.current) return;
    hasMeasured.current = true;
    const targetHeight = e.nativeEvent.layout.height;
    animatedHeight.value = withTiming(targetHeight, {
      duration: CONTENT_ANIMATE_DURATION,
      easing: Easing.out(Easing.cubic),
    }, (finished) => {
      if (finished) {
        runOnJS(transitionToReady)();
      }
    });
    contentOpacity.value = withTiming(1, {
      duration: CONTENT_ANIMATE_DURATION,
      easing: Easing.out(Easing.cubic),
    });
  }, [animatedHeight, contentOpacity, transitionToReady]);

  const containerAnimatedStyle = useAnimatedStyle(() => ({
    height: animatedHeight.value,
    overflow: 'hidden' as const,
  }));

  const contentAnimatedStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
  }));

  const [mode, setMode] = useState<'pick' | 'create'>('pick');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    hide();
    setMode('pick');
    setName('');
    setBusy(false);
    setError(null);
  }, [hide]);

  const handleSelectPlaylist = useCallback(
    async (playlist: Playlist) => {
      if (!target || busy) return;
      setBusy(true);
      setError(null);
      handleClose();
      processingOverlayStore.getState().show(t('adding'));

      try {
        const songIds = await resolveSongIds(target);
        if (!songIds) throw new Error('Could not resolve songs');

        const success = await addToPlaylist(playlist.id, songIds);
        if (!success) throw new Error('API returned false');

        if (playlist.id in playlistDetailStore.getState().playlists) {
          const updated = await playlistDetailStore.getState().fetchPlaylist(playlist.id);
          if (updated && playlist.id in musicCacheStore.getState().cachedItems) {
            syncCachedItemTracks(playlist.id, updated.entry ?? []);
          }
        }
        if (showSongInPlaylist === "show") {
          playlistLibraryStore.getState().fetchAllPlaylistsWithSongs();
        } else {
          playlistLibraryStore.getState().fetchAllPlaylists();
        }
        processingOverlayStore.getState().showSuccess(t('addedToPlaylist'));
      } catch {
        processingOverlayStore.getState().showError(t('failedToAddToPlaylist'));
      }
    },
    [target, busy, handleClose],
  );

  const handleCreatePlaylist = useCallback(async () => {
    if (!target || busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('pleaseEnterPlaylistName'));
      return;
    }
    setBusy(true);
    setError(null);

    try {
      const songIds = await resolveSongIds(target);
      if (!songIds) throw new Error('Could not resolve songs');

      const success = await createNewPlaylist(trimmed, songIds);
      if (!success) throw new Error('API returned false');

      handleClose();
      if (showSongInPlaylist === "show") {
        playlistLibraryStore.getState().fetchAllPlaylistsWithSongs();
      } else {
        playlistLibraryStore.getState().fetchAllPlaylists();
      }
      processingOverlayStore.getState().show(t('creating'));
      processingOverlayStore.getState().showSuccess(t('playlistCreated'));
    } catch {
      setBusy(false);
      setError(t('failedToCreatePlaylist'));
    }
  }, [target, busy, name, handleClose]);

  const handleShowCreate = useCallback(() => {
    setMode('create');
    setError(null);
  }, []);

  const handleBackToPick = useCallback(() => {
    setMode('pick');
    setName('');
    setError(null);
  }, []);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        title: { color: colors.textPrimary },
        subtitle: { color: colors.textSecondary },
        input: {
          backgroundColor: colors.inputBg,
          color: colors.textPrimary,
          borderColor: colors.border,
        },
        createButton: { backgroundColor: colors.primary },
        errorText: { color: colors.red },
        playlistName: { color: colors.textPrimary },
        playlistCount: { color: colors.textSecondary },
        newPlaylistLabel: { color: colors.primary },
        separator: { backgroundColor: colors.border },
      }),
    [colors],
  );

  const subtitle = target ? getSubtitleText(target, t) : '';
  const coverArtId = target ? getTargetCoverArt(target) : undefined;

  const numberOfMatch = (playlist: Playlist | PlaylistWithSongs) => {
    if (!playlist) return 0;
    if (!(playlist as PlaylistWithSongs)?.entry) return 0;

    const playlistWithSongs = playlist as PlaylistWithSongs;

    if (target?.type === 'song') {
      const matchCount = playlistWithSongs.entry?.filter((current_entry) => target.item.id === current_entry.id).length || 0;
      return matchCount;
    }
    else if (target?.type === "album") {
      return 0;
    }

    return 0;
  }
  return (
    <BottomSheet visible={visible} onClose={handleClose} maxHeight="70%">
      <View style={styles.header}>
        {coverArtId && (
          <CachedImage coverArtId={coverArtId} size={150} style={styles.coverArt} resizeMode="cover" />
        )}
        <View style={styles.headerText}>
          <Text style={[styles.title, dynamicStyles.title]} numberOfLines={1}>
            {t('addToPlaylist')}
          </Text>
          <Text style={[styles.subtitle, dynamicStyles.subtitle]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </View>

      <Animated.View style={[styles.flexContainer, phase !== 'ready' && containerAnimatedStyle]}>
        {phase === 'loading' ? (
          <ActivityIndicator style={styles.loadingIndicator} color={colors.textSecondary} />
        ) : (
          <Animated.View
            style={[
              styles.flexContainer,
              contentAnimatedStyle,
              // During 'measuring', render absolutely positioned and off-screen
              // so the content can report its natural height without affecting layout
              phase === 'measuring' && styles.measuring,
            ]}
            onLayout={phase === 'measuring' ? handleContentLayout : undefined}
          >
            {mode === 'pick' ? (
              <ScrollView
                style={styles.listContainer}
                contentContainerStyle={styles.listContent}
                bounces={false}
                showsVerticalScrollIndicator={false}
              >
                {/* New Playlist row */}
                <Pressable
                  onPress={handleShowCreate}
                  style={({ pressed }) => [
                    styles.playlistRow,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
                  <Text style={[styles.newPlaylistLabel, dynamicStyles.newPlaylistLabel]}>
                    {t('newPlaylist')}
                  </Text>
                </Pressable>

                <View style={[styles.separator, dynamicStyles.separator]} />

                {playlists.map((playlist) => (
                  <Pressable
                    key={playlist.id}
                    onPress={() => handleSelectPlaylist(playlist)}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.playlistRow,
                      pressed && styles.rowPressed,
                    ]}
                  >
                    <Ionicons name="list-outline" size={22} color={colors.textSecondary} />
                    <View style={styles.playlistInfo}>
                      <Text
                        style={[styles.playlistName, dynamicStyles.playlistName]}
                        numberOfLines={1}
                      >
                        {playlist.name}
                      </Text>
                      <Text style={[styles.playlistCount, dynamicStyles.playlistCount]}>
                        {t('trackWithCount', { count: playlist.songCount ?? 0 })}
                      </Text>
                    </View>
                    {numberOfMatch(playlist) > 0 ?
                      <View>

                        <Text style={[styles.playlistName, dynamicStyles.playlistName]}
                          numberOfLines={1}>
                          {i18n.t('numberOfTimesInPlaylist', { count: numberOfMatch(playlist) })}
                        </Text>

                      </View> : null}
                  </Pressable>
                ))}

                {playlists.length === 0 && playlistsLoading && (
                  <ActivityIndicator style={styles.loadingIndicator} color={colors.textSecondary} />
                )}

                {playlists.length === 0 && !playlistsLoading && !playlistsFetchError && (
                  <Text style={[styles.emptyText, dynamicStyles.playlistCount]}>
                    {t('noPlaylistsYet')}
                  </Text>
                )}

                {playlistsFetchError && playlists.length === 0 && !playlistsLoading && (
                  <Text style={[styles.emptyText, dynamicStyles.errorText]}>
                    {t('failedToLoadPlaylists')}
                  </Text>
                )}

                {playlists.length > 0 && playlistsLoading && (
                  <ActivityIndicator style={styles.loadingIndicator} size="small" color={colors.textSecondary} />
                )}
              </ScrollView>
            ) : (
              <View style={styles.formSection}>
                {/* Back arrow */}
                <Pressable onPress={handleBackToPick} style={styles.backButton}>
                  <Ionicons name="arrow-back" size={20} color={colors.primary} />
                  <Text style={[styles.backLabel, { color: colors.primary }]}>{t('back')}</Text>
                </Pressable>

                <Text style={[styles.label, dynamicStyles.subtitle]}>{t('playlistName')}</Text>
                <TextInput
                  style={[styles.input, dynamicStyles.input]}
                  value={name}
                  onChangeText={setName}
                  placeholder={t('enterPlaylistNamePlaceholder')}
                  placeholderTextColor={colors.textSecondary}
                  returnKeyType="done"
                  autoFocus
                  editable={!busy}
                  onSubmitEditing={handleCreatePlaylist}
                />

                {error && (
                  <Text style={[styles.errorText, dynamicStyles.errorText]}>{error}</Text>
                )}

                <Pressable
                  onPress={handleCreatePlaylist}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.createButton,
                    dynamicStyles.createButton,
                    pressed && styles.buttonPressed,
                    busy && styles.buttonDisabled,
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="add-outline" size={18} color="#fff" />
                      <Text style={styles.createButtonText}>{t('createPlaylist')}</Text>
                    </>
                  )}
                </Pressable>
              </View>
            )}
          </Animated.View>
        )}
      </Animated.View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginBottom: 16,
  },
  coverArt: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: 'rgba(128,128,128,0.12)',
    marginRight: 12,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '400',
  },
  flexContainer: {
    flexShrink: 1,
  },
  listContainer: {
    flexShrink: 1,
  },
  listContent: {
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  rowPressed: {
    opacity: 0.6,
  },
  playlistInfo: {
    flex: 1,
    minWidth: 0,
  },
  playlistName: {
    fontSize: 14,
  },
  playlistCount: {
    fontSize: 14,
    marginTop: 1,
  },
  newPlaylistLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
  },
  loadingIndicator: {
    paddingVertical: 16,
  },
  formSection: {
    paddingHorizontal: 4,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 16,
  },
  backLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  input: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  errorText: {
    fontSize: 14,
    marginTop: 12,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 20,
    marginBottom: 8,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  measuring: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
