import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { HeaderHeightContext } from '@react-navigation/elements';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';

import { EditShareSheet } from '../components/EditShareSheet';
import { EmptyState } from '../components/EmptyState';
import { GradientBackground } from '../components/GradientBackground';
import { BottomChrome } from '../components/BottomChrome';
import { useRefreshControlKey } from '../hooks/useRefreshControlKey';
import { useTheme } from '../hooks/useTheme';
import { useThemedAlert } from '../hooks/useThemedAlert';
import { ThemedAlert } from '../components/ThemedAlert';
import { type Share as SubsonicShare } from '../services/subsonicService';
import { editShareStore } from '../store/editShareStore';
import { rewriteShareUrl } from '../store/shareSettingsStore';
import { sharesStore } from '../store/sharesStore';
import { settingsStyles } from '../styles/settingsStyles';
import { minDelay } from '../utils/stringHelpers';

function formatDate(date: Date | string | undefined | null): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(i18next.language, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(date: Date | string | undefined | null): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(i18next.language, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isExpired(share: SubsonicShare): boolean {
  if (!share.expires) return false;
  const d = typeof share.expires === 'string' ? new Date(share.expires) : share.expires;
  return d.getTime() < Date.now();
}

function getShareTitle(share: SubsonicShare, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (share.description) return share.description;
  const entries = share.entry ?? [];
  if (entries.length === 0) return t('shareId', { id: share.id });
  const first = entries[0].title ?? entries[0].album ?? t('untitled');
  return entries.length > 1 ? t('shareEntryPlusMore', { title: first, count: entries.length - 1 }) : first;
}

function getShareSubtitle(share: SubsonicShare, t: (key: string, options?: Record<string, unknown>) => string): string {
  const entries = share.entry ?? [];
  if (entries.length === 0) return t('noItems');
  if (entries.length === 1) return entries[0].artist ?? '';
  return t('itemCount', { count: entries.length });
}

export function ShareBrowserScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { alert, alertProps } = useThemedAlert();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const refreshControlKey = useRefreshControlKey();

  const shares = sharesStore((s) => s.shares ?? []);
  const sharesLoading = sharesStore((s) => s.loading);
  const sharesError = sharesStore((s) => s.error);
  const sharesNotAvailable = sharesStore((s) => s.notAvailable);

  const [refreshing, setRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deleteAnim = useSharedValue(0);

  const deleteAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(deleteAnim.value, [0, 0.3, 0.5, 0.7, 1], [0, -6, 0, -3, 0]) },
      { rotate: `${interpolate(deleteAnim.value, [0, 0.15, 0.3, 0.45, 0.6, 1], [0, 12, -10, 6, -4, 0])}deg` },
    ],
  }));

  useEffect(() => {
    sharesStore.getState().fetchShares();
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const delay = minDelay();
    await sharesStore.getState().fetchShares();
    await delay;
    setRefreshing(false);
  }, []);

  const handleCopyUrl = useCallback(async (share: SubsonicShare) => {
    const url = rewriteShareUrl(share.url);
    await Clipboard.setStringAsync(url);
    setCopiedId(share.id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleShareUrl = useCallback(async (share: SubsonicShare) => {
    const url = rewriteShareUrl(share.url);
    const title = getShareTitle(share, t);
    const entries = share.entry ?? [];
    const artist = entries.length === 1 ? entries[0].artist : undefined;
    const text = artist
      ? t('shareMessageAlbumWithArtist', { album: title, artist })
      : title;
    const message = Platform.OS === 'android' ? `${text}\n${url}` : text;
    await Share.share(
      { url, message, title },
      { subject: text },
    ).catch(() => { /* user dismissed */ });
  }, [t]);

  const handleEdit = useCallback((share: SubsonicShare) => {
    editShareStore.getState().show(share);
  }, []);

  const handleDelete = useCallback(
    (share: SubsonicShare) => {
      const title = getShareTitle(share, t);
      alert(t('deleteShare'), t('deleteShareMessage', { title }), [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'),
          style: 'destructive',
          onPress: async () => {
            setDeletingId(share.id);
            deleteAnim.value = 0;
            deleteAnim.value = withRepeat(
              withTiming(1, { duration: 1200, easing: Easing.linear }),
              -1,
            );

            const success = await sharesStore.getState().removeShare(share.id);

            cancelAnimation(deleteAnim);
            setDeletingId(null);
            if (!success) {
              alert(t('error'), t('failedToDeleteShare'));
            }
          },
        },
      ]);
    },
    [deleteAnim],
  );

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        sectionTitle: { color: colors.label },
        card: { backgroundColor: colors.card },
        shareTitle: { color: colors.textPrimary },
        shareSubtitle: { color: colors.textSecondary },
        shareMeta: { color: colors.textSecondary },
        separator: { borderBottomColor: colors.border },
        expiredBadge: { backgroundColor: colors.red },
      }),
    [colors],
  );

  return (
    <>
    <GradientBackground scrollable>
    <ScrollView
      style={settingsStyles.container}
      contentContainerStyle={[settingsStyles.content, { paddingTop: headerHeight + 16 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          key={refreshControlKey}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={colors.textSecondary}
          progressViewOffset={headerHeight}
        />
      }
    >
      {/* Shares List */}
      <View style={settingsStyles.section}>
        <Text style={[settingsStyles.sectionTitle, dynamicStyles.sectionTitle]}>
          {t('shares')}
        </Text>
        {sharesLoading && shares.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : sharesNotAvailable ? (
          <EmptyState
            icon="close-circle-outline"
            title={t('sharingNotAvailable')}
            subtitle={sharesError ?? t('sharingNotAvailableHint')}
          />
        ) : sharesError && shares.length === 0 ? (
          <View style={[settingsStyles.card, dynamicStyles.card]}>
            <View style={styles.cardContent}>
              <Text style={[styles.hint, { color: colors.red }]}>{sharesError}</Text>
            </View>
          </View>
        ) : shares.length === 0 ? (
          <EmptyState
            icon="share-social-outline"
            title={t('noSharesYet')}
            subtitle={t('noSharesYetHint')}
          />
        ) : (
          <View style={[settingsStyles.card, dynamicStyles.card]}>
            {shares.map((share, index) => (
              <View
                key={share.id}
                style={[
                  styles.shareRow,
                  index < shares.length - 1 && dynamicStyles.separator,
                  index < shares.length - 1 && styles.shareRowBorder,
                ]}
              >
                <View
                  style={[
                    deletingId === share.id && styles.deletingContent,
                  ]}
                >
                  <View style={styles.shareTitleRow}>
                    {isExpired(share) && (
                      <View style={[styles.expiredBadge, dynamicStyles.expiredBadge]}>
                        <Text style={styles.expiredBadgeText}>{t('expired')}</Text>
                      </View>
                    )}
                    <Text
                      style={[styles.shareTitle, dynamicStyles.shareTitle]}
                      numberOfLines={1}
                    >
                      {getShareTitle(share, t)}
                    </Text>
                  </View>
                  <Text
                    style={[styles.shareSubtitle, dynamicStyles.shareSubtitle]}
                    numberOfLines={1}
                  >
                    {getShareSubtitle(share, t)}
                  </Text>
                  <View style={styles.metaRow}>
                    <View style={styles.metaItem}>
                      <Ionicons name="calendar-outline" size={12} color={colors.textSecondary} />
                      <Text style={[styles.metaText, dynamicStyles.shareMeta]}>
                        {formatDate(share.created)}
                      </Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Ionicons name="time-outline" size={12} color={colors.textSecondary} />
                      <Text style={[styles.metaText, dynamicStyles.shareMeta]}>
                        {share.expires ? formatDate(share.expires) : t('never')}
                      </Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Ionicons name="eye-outline" size={12} color={colors.textSecondary} />
                      <Text style={[styles.metaText, dynamicStyles.shareMeta]}>
                        {share.visitCount ?? 0}
                      </Text>
                    </View>
                  </View>
                  {share.lastVisited && (
                    <Text style={[styles.lastVisited, dynamicStyles.shareMeta]}>
                      {t('lastVisited', { date: formatDateTime(share.lastVisited) })}
                    </Text>
                  )}
                </View>
                {deletingId === share.id ? (
                  <View style={styles.deletingIndicator}>
                    <Animated.View style={deleteAnimStyle}>
                      <Ionicons name="trash" size={22} color={colors.red} />
                    </Animated.View>
                  </View>
                ) : (
                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => handleShareUrl(share)}
                      style={({ pressed }) => [
                        styles.actionButton,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <Ionicons name="share-outline" size={16} color={colors.primary} />
                      <Text style={[styles.actionLabel, { color: colors.primary }]}>{t('share')}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleCopyUrl(share)}
                      style={({ pressed }) => [
                        styles.actionButton,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <Ionicons
                        name={copiedId === share.id ? 'checkmark' : 'copy-outline'}
                        size={16}
                        color={colors.primary}
                      />
                      <Text style={[styles.actionLabel, { color: colors.primary }]}>
                        {copiedId === share.id ? t('copied') : t('copy')}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleEdit(share)}
                      style={({ pressed }) => [
                        styles.actionButton,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <Ionicons name="pencil-outline" size={16} color={colors.primary} />
                      <Text style={[styles.actionLabel, { color: colors.primary }]}>{t('edit')}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleDelete(share)}
                      style={({ pressed }) => [
                        styles.actionButton,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.red} />
                      <Text style={[styles.actionLabel, { color: colors.red }]}>{t('delete')}</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
    <BottomChrome withSafeAreaPadding />
    </GradientBackground>

    <EditShareSheet />
    <ThemedAlert {...alertProps} />
    </>
  );
}

const styles = StyleSheet.create({
  cardContent: {
    padding: 16,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  shareRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  shareRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  deletingContent: {
    opacity: 0.35,
  },
  shareTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shareTitle: {
    fontSize: 16,
    fontWeight: '600',
    flexShrink: 1,
  },
  expiredBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  expiredBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  shareSubtitle: {
    fontSize: 14,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  deletingIndicator: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 10,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  metaRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
  },
  lastVisited: {
    fontSize: 12,
    marginTop: 4,
  },
  buttonPressed: {
    opacity: 0.8,
  },
});
