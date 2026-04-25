import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import { Stack } from 'expo-router';
import { HeaderHeightContext } from '@react-navigation/elements';
import { useCallback, useContext, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { GradientBackground } from '../components/GradientBackground';
import { BottomChrome } from '../components/BottomChrome';
import { useTheme } from '../hooks/useTheme';

const VIEWABLE_EXTENSIONS = new Set([
  '.log',
  '.txt',
  '.json',
  '.xml',
  '.csv',
  '.md',
  '.ini',
  '.cfg',
  '.conf',
  '.plist',
  '.yaml',
  '.yml',
]);

export function isViewableFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return VIEWABLE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

export function FileViewerScreen({ uri, name }: { uri: string; name: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const file = new File(uri);
        const text = await file.text();
        if (!cancelled) setContent(text);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : t('failedToReadFile'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uri]);

  const handleCopy = useCallback(async () => {
    if (!content) return;
    await Clipboard.setStringAsync(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  return (
    <>
      <Stack.Screen
        options={{
          title: name,
          headerBackTitle: t('back'),
          headerRight: () =>
            content != null ? (
              <Ionicons
                name={copied ? 'checkmark' : 'copy-outline'}
                size={22}
                color={copied ? colors.primary : colors.textPrimary}
                onPress={handleCopy}
                suppressHighlighting
              />
            ) : null,
        }}
      />
      <GradientBackground style={styles.container} scrollable>
        {error ? (
          <View style={styles.center}>
            <Ionicons
              name="alert-circle-outline"
              size={48}
              color={colors.textSecondary}
            />
            <Text style={[styles.errorText, { color: colors.textSecondary }]}>
              {error}
            </Text>
          </View>
        ) : content == null ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : content.length === 0 ? (
          <View style={styles.center}>
            <Text style={[styles.errorText, { color: colors.textSecondary }]}>
              {t('fileIsEmpty')}
            </Text>
          </View>
        ) : (
          <ScrollView
            style={[styles.scroll, { backgroundColor: colors.card }]}
            contentContainerStyle={[styles.scrollContent, { paddingTop: headerHeight + 16 }]}
          >
            <Text
              style={[styles.fileText, { color: colors.textPrimary }]}
              selectable
            >
              {content}
            </Text>
          </ScrollView>
        )}
        <BottomChrome withSafeAreaPadding />
      </GradientBackground>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    padding: 32,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
    margin: 12,
    borderRadius: 12,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  fileText: {
    fontSize: 12,
    fontFamily: 'Menlo',
    lineHeight: 18,
  },
});
