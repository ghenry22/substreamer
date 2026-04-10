import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from './BottomSheet';
import { CachedImage } from './CachedImage';
import { useTheme } from '../hooks/useTheme';
import { createShare } from '../services/subsonicService';
import { createShareStore } from '../store/createShareStore';
import { rewriteShareUrl } from '../store/shareSettingsStore';
import { sharesStore } from '../store/sharesStore';

const EXPIRATION_OPTIONS = [
  { labelKey: 'expiresNever', days: null },
  { labelKey: 'expires1Day', days: 1 },
  { labelKey: 'expires7Days', days: 7 },
  { labelKey: 'expires30Days', days: 30 },
  { labelKey: 'expires90Days', days: 90 },
  { labelKey: 'expires1Year', days: 365 },
] as const;

type ExpirationDays = (typeof EXPIRATION_OPTIONS)[number]['days'];

function expirationToTimestamp(days: ExpirationDays): number | undefined {
  if (days == null) return undefined;
  return Date.now() + days * 24 * 60 * 60 * 1000;
}

export function CreateShareSheet() {
  const visible = createShareStore((s) => s.visible);
  const shareType = createShareStore((s) => s.shareType);
  const itemId = createShareStore((s) => s.itemId);
  const songIds = createShareStore((s) => s.songIds);
  const itemName = createShareStore((s) => s.itemName);
  const artistName = createShareStore((s) => s.artistName);
  const coverArtId = createShareStore((s) => s.coverArtId);
  const hide = createShareStore((s) => s.hide);

  const { colors } = useTheme();
  const { t } = useTranslation();

  const [description, setDescription] = useState('');
  const [selectedExpiration, setSelectedExpiration] = useState<ExpirationDays>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleClose = useCallback(() => {
    hide();
    setDescription('');
    setSelectedExpiration(null);
    setCreating(false);
    setError(null);
    setShareUrl(null);
    setCopied(false);
  }, [hide]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    setError(null);

    const expires = expirationToTimestamp(selectedExpiration);
    const desc = description.trim() || undefined;

    let share;
    if (shareType === 'queue') {
      share = await createShare(songIds, desc, expires);
    } else {
      if (!itemId) {
        setError(t('missingItemId'));
        setCreating(false);
        return;
      }
      share = await createShare(itemId, desc, expires);
    }

    setCreating(false);
    if (share) {
      setShareUrl(rewriteShareUrl(share.url));
      sharesStore.getState().fetchShares();
    } else {
      setError(t('failedToCreateShare'));
    }
  }, [shareType, itemId, songIds, description, selectedExpiration]);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    await Clipboard.setStringAsync(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [shareUrl]);

  const handleShare = useCallback(async () => {
    if (!shareUrl) return;
    let text: string;
    if (shareType === 'queue') {
      text = t('shareMessageQueue');
    } else if (shareType === 'playlist') {
      text = t('shareMessagePlaylist', { playlist: itemName });
    } else if (artistName) {
      text = t('shareMessageAlbumWithArtist', { album: itemName, artist: artistName });
    } else {
      text = t('shareMessageAlbum', { album: itemName });
    }
    const message = Platform.OS === 'android' ? `${text}\n${shareUrl}` : text;
    await Share.share(
      { url: shareUrl, message, title: itemName },
      { subject: text },
    ).catch(() => { /* user dismissed */ });
  }, [shareUrl, shareType, itemName, artistName, t]);

  const typeLabel = shareType === 'queue' ? t('queue') : shareType === 'playlist' ? t('playlist') : t('album');

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        title: { color: colors.textPrimary },
        subtitle: { color: colors.textSecondary },
        label: { color: colors.textSecondary },
        input: {
          backgroundColor: colors.inputBg,
          color: colors.textPrimary,
          borderColor: colors.border,
        },
        chipSelected: {
          backgroundColor: colors.primary,
        },
        chipDefault: {
          backgroundColor: colors.inputBg,
          borderColor: colors.border,
        },
        chipTextSelected: { color: '#fff' },
        chipTextDefault: { color: colors.textPrimary },
        createButton: { backgroundColor: colors.primary },
        errorText: { color: colors.red },
        urlContainer: {
          backgroundColor: colors.inputBg,
          borderColor: colors.border,
        },
        urlText: { color: colors.textPrimary },
        shareButton: { backgroundColor: colors.primary },
      }),
    [colors],
  );

  return (
    <BottomSheet visible={visible} onClose={handleClose}>
      <View style={styles.header}>
        {coverArtId && (
          <CachedImage coverArtId={coverArtId} size={150} style={styles.coverArt} resizeMode="cover" />
        )}
        <View style={styles.headerText}>
          <Text style={[styles.title, dynamicStyles.title]} numberOfLines={1}>
            {t('shareEntity', { type: typeLabel })}
          </Text>
          <Text style={[styles.subtitle, dynamicStyles.subtitle]} numberOfLines={1}>
            {itemName}
          </Text>
        </View>
      </View>

        {shareUrl ? (
          <View style={styles.successSection}>
            <View style={styles.successHeader}>
              <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
              <Text style={[styles.successLabel, dynamicStyles.title]}>
                {t('shareCreated')}
              </Text>
            </View>

            <View style={[styles.urlContainer, dynamicStyles.urlContainer]}>
              <Text style={[styles.urlText, dynamicStyles.urlText]} selectable numberOfLines={2}>
                {shareUrl}
              </Text>
            </View>

            <Pressable
              onPress={handleShare}
              style={({ pressed }) => [
                styles.shareButton,
                dynamicStyles.shareButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Ionicons name="share-outline" size={18} color="#fff" />
              <Text style={styles.shareButtonText}>{t('share')}</Text>
            </Pressable>

            <View style={styles.secondaryRow}>
              <Pressable
                onPress={handleCopy}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={colors.primary} />
                <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>
                  {copied ? t('copied') : t('copyToClipboard')}
                </Text>
              </Pressable>

              <Pressable onPress={handleClose} style={styles.doneButton}>
                <Text style={[styles.doneButtonText, { color: colors.primary }]}>{t('done')}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.formSection}>
            <Text style={[styles.label, dynamicStyles.label]}>{t('descriptionOptional')}</Text>
            <TextInput
              style={[styles.input, dynamicStyles.input]}
              value={description}
              onChangeText={setDescription}
              placeholder={t('addANotePlaceholder')}
              placeholderTextColor={colors.textSecondary}
              returnKeyType="done"
              editable={!creating}
            />

            <Text style={[styles.label, dynamicStyles.label, styles.expirationLabel]}>
              {t('expires')}
            </Text>
            <View style={styles.chipRow}>
              {EXPIRATION_OPTIONS.map((opt) => {
                const selected = selectedExpiration === opt.days;
                return (
                  <Pressable
                    key={opt.labelKey}
                    onPress={() => setSelectedExpiration(opt.days)}
                    disabled={creating}
                    style={[
                      styles.chip,
                      selected ? dynamicStyles.chipSelected : dynamicStyles.chipDefault,
                      !selected && styles.chipBorder,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        selected ? dynamicStyles.chipTextSelected : dynamicStyles.chipTextDefault,
                      ]}
                    >
                      {t(opt.labelKey)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {error && (
              <Text style={[styles.errorText, dynamicStyles.errorText]}>{error}</Text>
            )}

            <Pressable
              onPress={handleCreate}
              disabled={creating}
              style={({ pressed }) => [
                styles.createButton,
                dynamicStyles.createButton,
                pressed && styles.buttonPressed,
                creating && styles.buttonDisabled,
              ]}
            >
              {creating ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="share-outline" size={18} color="#fff" />
                  <Text style={styles.createButtonText}>{t('createShare')}</Text>
                </>
              )}
            </Pressable>
          </View>
        )}
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
  formSection: {
    paddingHorizontal: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  expirationLabel: {
    marginTop: 16,
  },
  input: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  chipBorder: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
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
  successSection: {
    paddingHorizontal: 4,
  },
  successHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  successLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  urlContainer: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 16,
  },
  urlText: {
    fontSize: 14,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 12,
  },
  shareButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
    marginBottom: 4,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '500',
  },
  doneButton: {
    paddingVertical: 12,
  },
  doneButtonText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
