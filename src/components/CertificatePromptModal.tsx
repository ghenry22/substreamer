import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BottomSheet } from './BottomSheet';
import { useTheme } from '../hooks/useTheme';
import { type CertificateInfo } from '../../modules/expo-ssl-trust/src';

export interface CertificatePromptModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** The certificate information to display */
  certInfo: CertificateInfo | null;
  /** The server hostname */
  hostname: string;
  /** Whether this is a certificate rotation (fingerprint changed) */
  isRotation?: boolean;
  /** Whether the user is manually adding this cert from settings (non-alarming tone for valid certs) */
  isManualAdd?: boolean;
  /** Called when the user accepts the certificate */
  onTrust: () => void;
  /** Called when the user cancels */
  onCancel: () => void;
}

export const CertificatePromptModal = memo(function CertificatePromptModal({
  visible,
  certInfo,
  hostname,
  isRotation = false,
  isManualAdd = false,
  onTrust,
  onCancel,
}: CertificatePromptModalProps) {
  const { colors } = useTheme();

  const handleTrust = useCallback(() => {
    onTrust();
  }, [onTrust]);

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  if (!certInfo) return null;

  return (
    <BottomSheet visible={visible} onClose={onCancel} maxHeight="85%">
      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
      >
          {/* Header */}
          <View style={styles.headerRow}>
            <Ionicons
              name={isRotation ? 'alert-circle' : isManualAdd && !certInfo.isSelfSigned ? 'shield-checkmark-outline' : 'shield-outline'}
              size={28}
              color={isRotation ? '#F44336' : isManualAdd && !certInfo.isSelfSigned ? colors.primary : '#FF9800'}
            />
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              {isRotation ? 'Certificate Changed' : isManualAdd && !certInfo.isSelfSigned ? 'Certificate Details' : 'Untrusted Certificate'}
            </Text>
          </View>

          {isRotation ? (
            <Text style={[styles.warning, { color: '#F44336' }]}>
              WARNING: The SSL certificate for this server has changed since you
              last connected. This could indicate a server reconfiguration, but
              could also mean someone is intercepting your connection. Only
              proceed if you trust this server.
            </Text>
          ) : isManualAdd && !certInfo.isSelfSigned ? (
            <Text style={[styles.description, { color: colors.textSecondary }]}>
              The server at {hostname} has a valid certificate signed by a
              trusted authority. You can add it to your trusted list to pin this
              specific certificate for extra security.
            </Text>
          ) : (
            <Text style={[styles.description, { color: colors.textSecondary }]}>
              The server at {hostname} is presenting a certificate that is not
              trusted by your device. This is common for self-hosted servers
              using self-signed certificates. Review the details below before
              deciding to trust it.
            </Text>
          )}

          {/* Certificate Details */}
          <View
            style={[styles.detailsCard, { backgroundColor: colors.background }]}
          >
            <DetailRow
              label="Server"
              value={hostname}
              colors={colors}
            />
            <DetailRow
              label="Subject"
              value={certInfo.subject}
              colors={colors}
            />
            <DetailRow
              label="Issuer"
              value={certInfo.issuer}
              colors={colors}
            />
            <DetailRow
              label="Self-Signed"
              value={certInfo.isSelfSigned ? 'Yes' : 'No'}
              colors={colors}
            />
            <DetailRow
              label="Valid From"
              value={formatDate(certInfo.validFrom)}
              colors={colors}
            />
            <DetailRow
              label="Valid To"
              value={formatDate(certInfo.validTo)}
              colors={colors}
            />
            <DetailRow
              label="Serial"
              value={certInfo.serialNumber}
              colors={colors}
              mono
            />
          </View>

          {/* Fingerprint section - prominent */}
          <Text
            style={[styles.fingerprintLabel, { color: colors.textSecondary }]}
          >
            SHA-256 Fingerprint
          </Text>
          <View
            style={[
              styles.fingerprintCard,
              { backgroundColor: colors.background },
            ]}
          >
            <Text
              style={[styles.fingerprintValue, { color: colors.textPrimary }]}
              selectable
            >
              {certInfo.sha256Fingerprint}
            </Text>
          </View>

          {/* Action Buttons */}
          <Pressable
            style={({ pressed }) => [
              styles.trustButton,
              {
                backgroundColor: isRotation ? '#F44336' : isManualAdd && !certInfo.isSelfSigned ? colors.primary : '#FF9800',
              },
              pressed && styles.buttonPressed,
            ]}
            onPress={handleTrust}
          >
            <Ionicons
              name="shield-checkmark-outline"
              size={20}
              color="#FFFFFF"
              style={styles.buttonIcon}
            />
            <Text style={styles.trustButtonText}>
              {isRotation
                ? 'Trust New Certificate'
                : 'Trust This Certificate'}
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.cancelButton,
              { borderColor: colors.border },
              pressed && styles.buttonPressed,
            ]}
            onPress={handleCancel}
          >
            <Text style={[styles.cancelButtonText, { color: colors.textPrimary }]}>
              Cancel
            </Text>
          </Pressable>
        </ScrollView>
    </BottomSheet>
  );
});

// --- Detail Row sub-component ---

interface DetailRowProps {
  label: string;
  value: string;
  colors: { textPrimary: string; textSecondary: string };
  mono?: boolean;
}

function DetailRow({ label, value, colors, mono }: DetailRowProps) {
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <Text
        style={[
          styles.detailValue,
          { color: colors.textPrimary },
          mono && styles.mono,
        ]}
        numberOfLines={2}
        selectable
      >
        {value}
      </Text>
    </View>
  );
}

// --- Helpers ---

function formatDate(isoString: string): string {
  if (isoString === 'Unknown') return isoString;
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

// --- Styles ---

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    marginTop: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  warning: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
    fontWeight: '500',
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  detailsCard: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: '500',
    width: 80,
    flexShrink: 0,
  },
  detailValue: {
    fontSize: 13,
    flex: 1,
    textAlign: 'right',
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: 12,
  },
  fingerprintLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 6,
  },
  fingerprintCard: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
  },
  fingerprintValue: {
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 18,
  },
  trustButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 10,
  },
  buttonIcon: {
    marginRight: 8,
  },
  trustButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  buttonPressed: {
    opacity: 0.8,
  },
});
