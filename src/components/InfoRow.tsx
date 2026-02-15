import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export interface InfoRowProps {
  label: string;
  value: string | null;
  labelColor: string;
  valueColor: string;
  borderColor: string;
}

/**
 * A reusable key–value row used in settings and detail screens.
 * Renders a label on the left and a value on the right, separated by a
 * hairline bottom border. Returns null when value is null or empty.
 */
export const InfoRow = memo(function InfoRow({
  label,
  value,
  labelColor,
  valueColor,
  borderColor,
}: InfoRowProps) {
  if (value == null || value === '') return null;
  return (
    <View style={[styles.infoRow, { borderBottomColor: borderColor }]}>
      <Text style={[styles.infoLabel, { color: labelColor }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoLabel: {
    fontSize: 15,
    flex: 1,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '500',
    marginLeft: 12,
  },
});
