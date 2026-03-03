import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CachedImage } from './CachedImage';
import { StarRatingInput } from './StarRating';
import { useTheme } from '../hooks/useTheme';
import { setRating as setRatingApi } from '../services/subsonicService';
import { ratingStore } from '../store/ratingStore';
import { setRatingStore } from '../store/setRatingStore';
import { minDelay } from '../utils/stringHelpers';

const COVER_SIZE = 300;
const SUCCESS_GREEN = '#34C759';
const ERROR_RED = '#FF3B30';
const MIN_SPINNER_MS = 600;
const SUCCESS_DELAY_MS = 600;
const ERROR_DELAY_MS = 2000;

type SaveState = 'idle' | 'saving' | 'success' | 'error';

export function SetRatingSheet() {
  const visible = setRatingStore((s) => s.visible);
  const entityType = setRatingStore((s) => s.entityType);
  const entityId = setRatingStore((s) => s.entityId);
  const entityName = setRatingStore((s) => s.entityName);
  const coverArtId = setRatingStore((s) => s.coverArtId);
  const currentRating = setRatingStore((s) => s.currentRating);
  const hide = setRatingStore((s) => s.hide);

  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [localRating, setLocalRating] = useState(currentRating);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const prevVisible = useRef(false);
  useEffect(() => {
    if (visible && !prevVisible.current) {
      setLocalRating(currentRating);
      setSaveState('idle');
    }
    prevVisible.current = visible;
  }, [visible, currentRating]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const isBusy = saveState !== 'idle' && saveState !== 'error';

  const handleClose = useCallback(() => {
    if (isBusy) return;
    hide();
  }, [isBusy, hide]);

  const handleRatingChange = useCallback((newRating: number) => {
    setLocalRating(newRating);
  }, []);

  const handleClearRating = useCallback(() => {
    setLocalRating(0);
  }, []);

  const handleDone = useCallback(async () => {
    if (!entityId || !entityType) {
      hide();
      return;
    }

    if (localRating === currentRating) {
      hide();
      return;
    }

    if (closeTimer.current) clearTimeout(closeTimer.current);
    setSaveState('saving');

    const [result] = await Promise.allSettled([
      setRatingApi(entityId, localRating),
      minDelay(MIN_SPINNER_MS),
    ]);

    if (result.status === 'fulfilled') {
      const rawServerRating = setRatingStore.getState().rawServerRating;
      ratingStore.getState().setOverride(entityId, localRating, rawServerRating);

      setSaveState('success');
      closeTimer.current = setTimeout(() => {
        hide();
        setSaveState('idle');
      }, SUCCESS_DELAY_MS);
    } else {
      setSaveState('error');
      closeTimer.current = setTimeout(() => {
        setSaveState('idle');
      }, ERROR_DELAY_MS);
    }
  }, [entityId, entityType, localRating, currentRating, hide]);

  const typeLabel =
    entityType === 'song'
      ? 'Song'
      : entityType === 'album'
        ? 'Album'
        : 'Artist';

  const ratingLabel =
    localRating > 0 ? `${localRating} of 5` : 'Not rated';

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        sheet: {
          backgroundColor: colors.card,
          paddingBottom: Math.max(insets.bottom, 16),
        },
        handle: { backgroundColor: colors.border },
        title: { color: colors.textPrimary },
        subtitle: { color: colors.textSecondary },
        ratingLabel: { color: colors.textSecondary },
        clearButton: {
          borderColor: colors.border,
        },
        clearText: { color: colors.textPrimary },
        doneButton: { backgroundColor: colors.primary },
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

        <View style={styles.header}>
          {coverArtId && (
            <CachedImage
              coverArtId={coverArtId}
              size={COVER_SIZE}
              style={styles.coverArt}
              resizeMode="cover"
            />
          )}
          <View style={styles.headerText}>
            <Text style={[styles.title, dynamicStyles.title]} numberOfLines={1}>
              Rate {typeLabel}
            </Text>
            <Text style={[styles.subtitle, dynamicStyles.subtitle]} numberOfLines={1}>
              {entityName}
            </Text>
          </View>
        </View>

        <View style={styles.ratingSection} pointerEvents={isBusy ? 'none' : 'auto'}>
          <StarRatingInput
            rating={localRating}
            onRatingChange={handleRatingChange}
            size={40}
            color={colors.primary}
            emptyColor={colors.primary}
          />

          <Text style={[styles.ratingLabel, dynamicStyles.ratingLabel]}>
            {ratingLabel}
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={handleClearRating}
            disabled={localRating === 0 || isBusy}
            style={({ pressed }) => [
              styles.clearButton,
              dynamicStyles.clearButton,
              pressed && localRating > 0 && !isBusy && styles.buttonPressed,
              (localRating === 0 || isBusy) && styles.buttonDisabled,
            ]}
          >
            <Text style={[styles.clearText, dynamicStyles.clearText]}>
              Clear Rating
            </Text>
          </Pressable>

          <Pressable
            onPress={handleDone}
            disabled={isBusy}
            style={({ pressed }) => [
              styles.doneButton,
              saveState === 'success'
                ? styles.doneButtonSuccess
                : saveState === 'error'
                  ? styles.doneButtonError
                  : dynamicStyles.doneButton,
              pressed && !isBusy && styles.buttonPressed,
            ]}
          >
            {saveState === 'saving' ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : saveState === 'success' ? (
              <Ionicons name="checkmark" size={20} color="#fff" />
            ) : saveState === 'error' ? (
              <View style={styles.doneErrorContent}>
                <Ionicons name="alert-circle" size={20} color="#fff" />
                <Text style={styles.doneText}>
                  Failed to save — tap to retry
                </Text>
              </View>
            ) : (
              <Text style={styles.doneText}>Save</Text>
            )}
          </Pressable>
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
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
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
  ratingSection: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  ratingLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 8,
  },
  actions: {
    paddingHorizontal: 4,
    marginTop: 16,
    gap: 8,
    marginBottom: 8,
  },
  clearButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    height: 48,
  },
  clearText: {
    fontSize: 16,
    fontWeight: '500',
  },
  doneButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    height: 48,
  },
  doneButtonSuccess: {
    backgroundColor: SUCCESS_GREEN,
  },
  doneButtonError: {
    backgroundColor: ERROR_RED,
  },
  doneErrorContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  doneText: {
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
});
