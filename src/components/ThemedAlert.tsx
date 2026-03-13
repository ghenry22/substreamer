import { memo, useCallback, useEffect, useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { type ThemeColors } from '../constants/theme';

const FADE_MS = 200;

interface ThemedAlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface ThemedAlertProps {
  visible: boolean;
  title: string;
  message?: string;
  buttons: ThemedAlertButton[];
  onDismiss: () => void;
  colors: ThemeColors;
}

/**
 * Themed alert dialog for Android. On iOS, use the native Alert.alert instead.
 *
 * Renders a centered modal card styled with the app's current theme colours,
 * matching the look of other overlays (ProcessingOverlay, CertificatePromptModal).
 */
export const ThemedAlert = memo(function ThemedAlert({
  visible,
  title,
  message,
  buttons,
  onDismiss,
  colors,
}: ThemedAlertProps) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.9);
  const hasAnimatedIn = useRef(false);

  useEffect(() => {
    if (visible) {
      hasAnimatedIn.current = true;
      opacity.value = withTiming(1, { duration: FADE_MS });
      scale.value = withTiming(1, { duration: FADE_MS });
    } else if (hasAnimatedIn.current) {
      opacity.value = withTiming(0, { duration: FADE_MS });
      scale.value = withTiming(0.9, { duration: FADE_MS });
    }
  }, [visible, opacity, scale]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const cardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  // Find the cancel button (if any) and separate from action buttons
  const cancelButton = buttons.find((b) => b.style === 'cancel');
  const actionButtons = buttons.filter((b) => b.style !== 'cancel');

  const handleButtonPress = useCallback(
    (button: ThemedAlertButton) => {
      onDismiss();
      button.onPress?.();
    },
    [onDismiss],
  );

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} onRequestClose={onDismiss} statusBarTranslucent>
      <View style={styles.container}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
        </Animated.View>

        <Animated.View style={[styles.card, { backgroundColor: colors.card }, cardStyle]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
          {message ? (
            <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>
          ) : null}

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.buttonRow}>
            {cancelButton ? (
              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: pressed ? colors.border : 'transparent' },
                ]}
                onPress={() => handleButtonPress(cancelButton)}
              >
                <Text style={[styles.buttonText, { color: colors.textSecondary }]}>
                  {cancelButton.text}
                </Text>
              </Pressable>
            ) : null}
            {actionButtons.map((button, i) => (
              <Pressable
                key={i}
                style={({ pressed }) => [
                  styles.button,
                  {
                    backgroundColor: pressed
                      ? button.style === 'destructive'
                        ? colors.red + '20'
                        : colors.primary + '20'
                      : 'transparent',
                  },
                ]}
                onPress={() => handleButtonPress(button)}
              >
                <Text
                  style={[
                    styles.buttonText,
                    styles.actionButtonText,
                    {
                      color: button.style === 'destructive' ? colors.red : colors.primary,
                    },
                  ]}
                >
                  {button.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  card: {
    width: '100%',
    borderRadius: 16,
    paddingTop: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 24,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginTop: 20,
  },
  buttonRow: {
    flexDirection: 'row',
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 16,
  },
  actionButtonText: {
    fontWeight: '600',
  },
});
