import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from './BottomSheet';
import { ThemedAlert } from './ThemedAlert';
import { useTheme } from '../hooks/useTheme';
import { useThemedAlert } from '../hooks/useThemedAlert';
import {
  FORMAT_PRESETS,
  playbackSettingsStore,
  type FormatPreset,
  type StreamFormat,
} from '../store/playbackSettingsStore';
import { streamFormatSheetStore } from '../store/streamFormatSheetStore';

type Mode = 'pick' | 'create';

function normalizeFormatInput(value: string): StreamFormat {
  return value === 'raw' ? 'raw' : value.trim().toLowerCase();
}

function findPreset(value: StreamFormat): FormatPreset | undefined {
  return FORMAT_PRESETS.find((p) => p.value === value);
}

export function StreamFormatSheet() {
  const visible = streamFormatSheetStore((s) => s.visible);
  const target = streamFormatSheetStore((s) => s.target);
  const hide = streamFormatSheetStore((s) => s.hide);

  const streamFormat = playbackSettingsStore((s) => s.streamFormat);
  const downloadFormat = playbackSettingsStore((s) => s.downloadFormat);
  const setStreamFormat = playbackSettingsStore((s) => s.setStreamFormat);
  const setDownloadFormat = playbackSettingsStore((s) => s.setDownloadFormat);

  const { colors } = useTheme();
  const { t } = useTranslation();
  const { alert, alertProps } = useThemedAlert();

  const currentValue = target === 'stream' ? streamFormat : downloadFormat;
  const currentPreset = findPreset(currentValue);
  const isCustomActive = currentPreset === undefined;

  const [mode, setMode] = useState<Mode>('pick');
  const [draftCustom, setDraftCustom] = useState('');

  // Reset to pick mode whenever the sheet (re-)opens
  useEffect(() => {
    if (visible) {
      setMode('pick');
      setDraftCustom(isCustomActive ? currentValue : '');
    }
  }, [visible, isCustomActive, currentValue]);

  const persist = useCallback(
    (next: StreamFormat) => {
      if (target === 'stream') {
        setStreamFormat(next);
      } else {
        setDownloadFormat(next);
      }
    },
    [target, setStreamFormat, setDownloadFormat],
  );

  const commitValue = useCallback(
    (value: StreamFormat) => {
      const next = normalizeFormatInput(value);
      const previous = currentValue;
      const isOpusOnIos =
        Platform.OS === 'ios' &&
        next.startsWith('opus') &&
        !previous.startsWith('opus');

      if (isOpusOnIos) {
        alert(
          t('iosOpusWarningTitle'),
          t('iosOpusWarningBody'),
          [
            { text: t('cancel'), style: 'cancel' },
            {
              text: t('iosOpusWarningConfirm'),
              onPress: () => {
                persist(next);
                hide();
              },
            },
          ],
        );
        return;
      }

      persist(next);
      hide();
    },
    [currentValue, persist, hide, alert, t],
  );

  const handleSelectPreset = useCallback(
    (preset: FormatPreset) => {
      commitValue(preset.value);
    },
    [commitValue],
  );

  const handleShowCreate = useCallback(() => {
    setMode('create');
    setDraftCustom(isCustomActive ? currentValue : '');
  }, [isCustomActive, currentValue]);

  const handleBackToPick = useCallback(() => {
    setMode('pick');
  }, []);

  const handleSaveCustom = useCallback(() => {
    const trimmed = draftCustom.trim();
    if (!trimmed) return;
    commitValue(trimmed);
  }, [draftCustom, commitValue]);

  const handleClose = useCallback(() => {
    hide();
  }, [hide]);

  const titleKey = target === 'stream' ? 'streamingFormat' : 'downloadFormat';
  const saveDisabled = draftCustom.trim().length === 0;

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        title: { color: colors.textPrimary },
        subtitle: { color: colors.textSecondary },
        rowLabel: { color: colors.textPrimary },
        customSubtitle: { color: colors.textSecondary },
        addRowLabel: { color: colors.primary },
        separator: { backgroundColor: colors.border },
        input: {
          backgroundColor: colors.inputBg,
          color: colors.textPrimary,
          borderColor: colors.border,
        },
        helpText: { color: colors.textSecondary },
        saveButton: { backgroundColor: colors.primary },
        backLabel: { color: colors.primary },
        sectionLabel: { color: colors.label },
      }),
    [colors],
  );

  return (
    <>
      <BottomSheet visible={visible} onClose={handleClose} maxHeight="85%">
        <View style={styles.header}>
          <Text style={[styles.title, dynamicStyles.title]} numberOfLines={1}>
            {t(titleKey)}
          </Text>
        </View>

        {mode === 'pick' ? (
          <ScrollView
            style={styles.listContainer}
            contentContainerStyle={styles.listContent}
            bounces={false}
            showsVerticalScrollIndicator={false}
          >
            {FORMAT_PRESETS.map((preset) => {
              const isActive = preset.value === currentValue;
              return (
                <Pressable
                  key={preset.value}
                  onPress={() => handleSelectPreset(preset)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <Text style={[styles.rowLabel, dynamicStyles.rowLabel]}>
                    {t(preset.labelKey)}
                  </Text>
                  {isActive && (
                    <Ionicons name="checkmark" size={22} color={colors.primary} />
                  )}
                </Pressable>
              );
            })}

            <View style={[styles.separator, dynamicStyles.separator]} />

            <Pressable
              onPress={handleShowCreate}
              style={({ pressed }) => [
                styles.row,
                pressed && styles.rowPressed,
              ]}
            >
              <View style={styles.addRowLabelWrap}>
                <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
                <View style={styles.addRowTextWrap}>
                  <Text style={[styles.addRowLabel, dynamicStyles.addRowLabel]}>
                    {t('addCustomFormat')}
                  </Text>
                  {isCustomActive && (
                    <Text style={[styles.customSubtitle, dynamicStyles.customSubtitle]} numberOfLines={1}>
                      {t('formatCustom')} — {currentValue}
                    </Text>
                  )}
                </View>
              </View>
              {isCustomActive && (
                <Ionicons name="checkmark" size={22} color={colors.primary} />
              )}
            </Pressable>
          </ScrollView>
        ) : (
          <View style={styles.formSection}>
            <Pressable onPress={handleBackToPick} style={styles.backButton}>
              <Ionicons name="arrow-back" size={20} color={colors.primary} />
              <Text style={[styles.backLabel, dynamicStyles.backLabel]}>{t('back')}</Text>
            </Pressable>

            <Text style={[styles.sectionLabel, dynamicStyles.sectionLabel]}>
              {t('customFormatTitle')}
            </Text>
            <TextInput
              style={[styles.input, dynamicStyles.input]}
              value={draftCustom}
              onChangeText={setDraftCustom}
              placeholder={t('customFormatPlaceholder')}
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSaveCustom}
              allowFontScaling={false}
            />
            <Text style={[styles.helpText, dynamicStyles.helpText]}>
              {t('customFormatHelp', { example: 'opus_128_car', codecs: 'opus, flac, aac' })}
            </Text>

            <Pressable
              onPress={handleSaveCustom}
              disabled={saveDisabled}
              style={({ pressed }) => [
                styles.saveButton,
                dynamicStyles.saveButton,
                pressed && styles.buttonPressed,
                saveDisabled && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.saveButtonText}>{t('save')}</Text>
            </Pressable>
          </View>
        )}
      </BottomSheet>
      <ThemedAlert {...alertProps} />
    </>
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
  listContainer: {
    flexShrink: 1,
  },
  listContent: {
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    gap: 12,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
  },
  addRowLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  addRowTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  addRowLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  customSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  formSection: {
    paddingHorizontal: 4,
    paddingBottom: 8,
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
  sectionLabel: {
    fontSize: 13,
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
  helpText: {
    fontSize: 13,
    marginTop: 10,
    lineHeight: 18,
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
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
