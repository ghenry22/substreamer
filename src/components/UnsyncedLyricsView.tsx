import { memo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { type LyricsLine } from '../services/subsonicService';

interface UnsyncedLyricsViewProps {
  lines: LyricsLine[];
  textColor: string;
}

export const UnsyncedLyricsView = memo(function UnsyncedLyricsView({
  lines,
  textColor,
}: UnsyncedLyricsViewProps) {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {lines.map((line, i) => (
        <View key={i} style={styles.lineWrap}>
          <Text style={[styles.lineText, { color: textColor }]}>{line.text}</Text>
        </View>
      ))}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  lineWrap: {
    marginVertical: 10,
  },
  lineText: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '600',
    textAlign: 'left',
  },
});
