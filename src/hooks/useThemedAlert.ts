import { Alert, Platform } from 'react-native';
import { useCallback, useState } from 'react';

import { useTheme } from './useTheme';

interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface AlertState {
  visible: boolean;
  title: string;
  message?: string;
  buttons: AlertButton[];
}

/**
 * Platform-aware alert hook.
 *
 * - iOS: delegates to the native Alert.alert (respects system dark mode).
 * - Android: renders a ThemedAlert modal styled with the app's theme.
 *
 * Returns `{ alert, alertProps }`:
 * - `alert(title, message?, buttons?)` — show the dialog
 * - `alertProps` — spread onto `<ThemedAlert {...alertProps} />` in the component tree
 */
export function useThemedAlert() {
  const { colors } = useTheme();
  const [state, setState] = useState<AlertState>({
    visible: false,
    title: '',
    message: undefined,
    buttons: [],
  });

  const dismiss = useCallback(() => {
    setState((s) => ({ ...s, visible: false }));
  }, []);

  const alert = useCallback(
    (title: string, message?: string, buttons?: AlertButton[]) => {
      const resolvedButtons = buttons ?? [{ text: 'OK', style: 'default' as const }];

      if (Platform.OS === 'ios') {
        Alert.alert(title, message, resolvedButtons);
        return;
      }

      setState({
        visible: true,
        title,
        message,
        buttons: resolvedButtons,
      });
    },
    [],
  );

  return {
    alert,
    alertProps: {
      visible: state.visible,
      title: state.title,
      message: state.message,
      buttons: state.buttons,
      onDismiss: dismiss,
      colors,
    },
  };
}
