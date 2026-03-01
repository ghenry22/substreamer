import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../hooks/useTheme';
import {
  searchArtists,
  type MusicBrainzArtist,
} from '../services/musicbrainzService';
import { artistDetailStore } from '../store/artistDetailStore';
import { mbidOverrideStore } from '../store/mbidOverrideStore';
import { mbidSearchStore } from '../store/mbidSearchStore';
import { processingOverlayStore } from '../store/processingOverlayStore';

const ROW_HEIGHT = 80;
const DEBOUNCE_MS = 400;

/* ------------------------------------------------------------------ */
/*  Result row                                                         */
/* ------------------------------------------------------------------ */

const ResultRow = memo(function ResultRow({
  artist,
  isCurrentMbid,
  onSelect,
  colors,
}: {
  artist: MusicBrainzArtist;
  isCurrentMbid: boolean;
  onSelect: (artist: MusicBrainzArtist) => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const handlePress = useCallback(() => onSelect(artist), [artist, onSelect]);

  const meta: string[] = [];
  if (artist.type) meta.push(artist.type);
  if (artist.country) meta.push(artist.country);
  if (artist.score != null) meta.push(`${artist.score}%`);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border },
        isCurrentMbid && { borderLeftColor: colors.primary, borderLeftWidth: 3 },
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.rowContent}>
        <View style={styles.rowHeader}>
          <Text
            style={[
              styles.artistName,
              { color: colors.textPrimary },
              isCurrentMbid && { color: colors.primary },
            ]}
            numberOfLines={1}
          >
            {artist.name}
          </Text>
          {isCurrentMbid && (
            <View style={[styles.currentBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.currentBadgeText}>Current</Text>
            </View>
          )}
        </View>
        {artist.disambiguation ? (
          <Text style={[styles.disambiguation, { color: colors.textSecondary }]} numberOfLines={1}>
            {artist.disambiguation}
          </Text>
        ) : null}
        <View style={styles.rowMeta}>
          <Text style={[styles.mbid, { color: colors.textSecondary }]} numberOfLines={1}>
            {artist.id}
          </Text>
          {meta.length > 0 && (
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              {meta.join(' · ')}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
});

/* ------------------------------------------------------------------ */
/*  Main sheet                                                         */
/* ------------------------------------------------------------------ */

export function MbidSearchSheet() {
  const visible = mbidSearchStore((s) => s.visible);
  const artistId = mbidSearchStore((s) => s.artistId);
  const artistName = mbidSearchStore((s) => s.artistName);
  const currentMbid = mbidSearchStore((s) => s.currentMbid);
  const hide = mbidSearchStore((s) => s.hide);

  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MusicBrainzArtist[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible && artistName) {
      setQuery(artistName);
      setSearched(false);
      setResults([]);
      setLoading(true);

      const timer = setTimeout(async () => {
        const data = await searchArtists(artistName);
        setResults(data);
        setLoading(false);
        setSearched(true);
      }, 100);

      return () => clearTimeout(timer);
    }
    return undefined;
  }, [visible, artistName]);

  const handleQueryChange = useCallback((text: string) => {
    setQuery(text);

    if (timerRef.current) clearTimeout(timerRef.current);

    const trimmed = text.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      setSearched(false);
      return;
    }

    setLoading(true);
    timerRef.current = setTimeout(async () => {
      const data = await searchArtists(trimmed);
      setResults(data);
      setLoading(false);
      setSearched(true);
    }, DEBOUNCE_MS);
  }, []);

  const handleSelect = useCallback(
    async (artist: MusicBrainzArtist) => {
      if (!artistId) return;
      const name = mbidSearchStore.getState().artistName ?? artist.name;
      mbidOverrideStore.getState().setOverride(artistId, name, artist.id);
      hide();
      processingOverlayStore.getState().show('Updating Artist…');
      try {
        await artistDetailStore.getState().fetchArtist(artistId);
        processingOverlayStore.getState().showSuccess('MBID Override Saved');
      } catch {
        processingOverlayStore.getState().showError('Failed to update artist');
      }
    },
    [artistId, hide],
  );

  const handleClose = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setQuery('');
    setResults([]);
    setLoading(false);
    setSearched(false);
    hide();
  }, [hide]);

  const renderItem = useCallback(
    ({ item }: { item: MusicBrainzArtist }) => (
      <ResultRow
        artist={item}
        isCurrentMbid={item.id === currentMbid}
        onSelect={handleSelect}
        colors={colors}
      />
    ),
    [currentMbid, handleSelect, colors],
  );

  const keyExtractor = useCallback((item: MusicBrainzArtist) => item.id, []);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        sheet: {
          backgroundColor: colors.card,
          paddingBottom: Math.max(insets.bottom, 16),
        },
        handle: { backgroundColor: colors.border },
        input: {
          backgroundColor: colors.inputBg,
          color: colors.textPrimary,
          borderColor: colors.border,
        },
      }),
    [colors, insets.bottom],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={handleClose} />

      <View style={[styles.sheet, dynamicStyles.sheet]}>
        <View style={[styles.handle, dynamicStyles.handle]} />

        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          Set MusicBrainz ID
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
          {artistName ?? 'Search for an artist'}
        </Text>

        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
          <TextInput
            style={[styles.input, dynamicStyles.input]}
            value={query}
            onChangeText={handleQueryChange}
            placeholder="Search MusicBrainz…"
            placeholderTextColor={colors.textSecondary}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query.length > 0 && (
            <Pressable onPress={() => handleQueryChange('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>

        <View style={styles.listContainer}>
          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                Searching MusicBrainz…
              </Text>
            </View>
          ) : results.length === 0 && searched ? (
            <View style={styles.centered}>
              <Ionicons name="search-outline" size={32} color={colors.textSecondary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                No artists found
              </Text>
            </View>
          ) : results.length > 0 ? (
            <FlashList
              data={results}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              keyboardShouldPersistTaps="handled"
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingHorizontal: 16,
    maxHeight: '80%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
    paddingHorizontal: 4,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '400',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  input: {
    flex: 1,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  listContainer: {
    flexShrink: 1,
    minHeight: 200,
  },
  row: {
    minHeight: ROW_HEIGHT,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowContent: {
    gap: 2,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  artistName: {
    fontSize: 16,
    fontWeight: '600',
    flexShrink: 1,
  },
  currentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  currentBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  disambiguation: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  mbid: {
    fontSize: 11,
    fontFamily: 'monospace',
    flexShrink: 1,
  },
  metaText: {
    fontSize: 11,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  emptyText: {
    fontSize: 14,
  },
});
