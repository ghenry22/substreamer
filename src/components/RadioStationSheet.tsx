import Ionicons from "@react-native-vector-icons/ionicons/static";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from './BottomSheet';
import { useTheme } from '../hooks/useTheme';
import {
  createRadioStation,
  deleteRadioStation,
  updateRadioStation,
  type InternetRadioStation,
} from '../services/subsonicService';
import { playbackToastStore } from '../store/playbackToastStore';
import { radioStore } from '../store/radioStore';

export interface RadioStationSheetProps {
  visible: boolean;
  /** Station being edited, or null to create a new one. */
  station: InternetRadioStation | null;
  onClose: () => void;
  /** Pre-filled values when adding a station found in the catalog. */
  prefill?: { name: string; streamUrl: string; homePageUrl?: string } | null;
}

/**
 * Create/edit form for a server-side internet radio station
 * (Subsonic create/update/deleteInternetRadioStation — Navidrome restricts
 * these to admin accounts; the server's error is surfaced inline).
 */
export function RadioStationSheet({ visible, station, onClose, prefill }: RadioStationSheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  const [name, setName] = useState('');
  const [streamUrl, setStreamUrl] = useState('');
  const [homepageUrl, setHomepageUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(station?.name ?? prefill?.name ?? '');
      setStreamUrl(station?.streamUrl ?? prefill?.streamUrl ?? '');
      setHomepageUrl(station?.homePageUrl ?? prefill?.homePageUrl ?? '');
      setError(null);
      setBusy(false);
    }
  }, [visible, station, prefill]);

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    const trimmedStream = streamUrl.trim();
    if (!trimmedName || !trimmedStream) {
      setError(t('stationFieldsRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    const args = {
      name: trimmedName,
      streamUrl: trimmedStream,
      homepageUrl: homepageUrl.trim() || undefined,
    };
    const result = station
      ? await updateRadioStation({ id: station.id, ...args })
      : await createRadioStation(args);
    if (result.ok) {
      playbackToastStore.getState().flashSuccess(t('radioStationSaved'));
      await radioStore.getState().fetchStations();
      onClose();
    } else {
      setBusy(false);
      setError(result.error);
    }
  }, [name, streamUrl, homepageUrl, station, onClose, t]);

  const handleDelete = useCallback(() => {
    if (!station) return;
    Alert.alert(
      t('deleteRadioStation'),
      t('deleteStationConfirm', { name: station.name }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'),
          style: 'destructive',
          onPress: async () => {
            const result = await deleteRadioStation(station.id);
            if (result.ok) {
              await radioStore.getState().fetchStations();
              onClose();
            } else {
              setError(result.error);
            }
          },
        },
      ],
    );
  }, [station, onClose, t]);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        title: { color: colors.textPrimary },
        label: { color: colors.textSecondary },
        input: {
          backgroundColor: colors.inputBg,
          color: colors.textPrimary,
          borderColor: colors.border,
        },
        saveButton: { backgroundColor: colors.primary },
      }),
    [colors],
  );

  const saveDisabled = busy || !name.trim() || !streamUrl.trim();

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <Text style={[styles.title, dynamicStyles.title]} numberOfLines={1}>
          {station ? t('editRadioStation') : t('addRadioStation')}
        </Text>
      </View>

      <View style={styles.formSection}>
        <Text style={[styles.label, dynamicStyles.label]}>{t('stationName')}</Text>
        <TextInput
          style={[styles.input, dynamicStyles.input]}
          value={name}
          onChangeText={setName}
          placeholderTextColor={colors.textSecondary}
          returnKeyType="next"
          autoFocus={!station && !prefill}
        />

        <Text style={[styles.label, dynamicStyles.label, styles.labelSpacing]}>
          {t('stationStreamUrl')}
        </Text>
        <TextInput
          style={[styles.input, dynamicStyles.input]}
          value={streamUrl}
          onChangeText={setStreamUrl}
          placeholder="https://…"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="next"
        />

        <Text style={[styles.label, dynamicStyles.label, styles.labelSpacing]}>
          {t('stationHomepageUrl')}
        </Text>
        <TextInput
          style={[styles.input, dynamicStyles.input]}
          value={homepageUrl}
          onChangeText={setHomepageUrl}
          placeholder="https://…"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          onSubmitEditing={handleSave}
        />

        {error != null && (
          <Text style={[styles.errorText, { color: colors.red }]}>{error}</Text>
        )}

        <Pressable
          onPress={handleSave}
          disabled={saveDisabled}
          style={({ pressed }) => [
            styles.saveButton,
            dynamicStyles.saveButton,
            pressed && styles.buttonPressed,
            saveDisabled && styles.buttonDisabled,
          ]}
        >
          <Ionicons name="checkmark" size={18} color="#fff" />
          <Text style={styles.saveButtonText}>{t('save')}</Text>
        </Pressable>

        {station != null && (
          <Pressable
            onPress={handleDelete}
            disabled={busy}
            style={({ pressed }) => [styles.deleteButton, pressed && styles.buttonPressed]}
          >
            <Ionicons name="trash-outline" size={16} color={colors.red} />
            <Text style={[styles.deleteButtonText, { color: colors.red }]}>
              {t('deleteRadioStation')}
            </Text>
          </Pressable>
        )}

        <Pressable onPress={onClose} style={styles.cancelButton}>
          <Text style={[styles.cancelButtonText, { color: colors.primary }]}>{t('cancel')}</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 4,
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  formSection: {
    paddingHorizontal: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  labelSpacing: {
    marginTop: 16,
  },
  input: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  errorText: {
    fontSize: 13,
    marginTop: 12,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 20,
    marginBottom: 8,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  deleteButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 4,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
});
