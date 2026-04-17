import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';

export interface Segment<K extends string = string> {
  key: K;
  label: string;
}

export const SegmentControl = memo(function SegmentControl<K extends string>({
  segments,
  selected,
  onSelect,
}: {
  segments: readonly Segment<K>[];
  selected: K;
  onSelect: (segment: K) => void;
}) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.inputBg + 'D9' }]}>
      {segments.map(({ key, label }) => {
        const isActive = selected === key;
        return (
          <Pressable
            key={key}
            onPress={() => onSelect(key)}
            style={[
              styles.button,
              isActive && [styles.buttonActive, { backgroundColor: colors.card }],
            ]}
          >
            <Text
              style={[
                styles.label,
                { color: isActive ? colors.textPrimary : colors.textSecondary },
                isActive && styles.labelActive,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}) as <K extends string>(props: {
  segments: readonly Segment<K>[];
  selected: K;
  onSelect: (segment: K) => void;
}) => React.JSX.Element;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 10,
    padding: 3,
  },
  button: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  buttonActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 2,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
  },
  labelActive: {
    fontWeight: '600',
  },
});
