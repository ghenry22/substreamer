import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import WaveformLogo from '../components/WaveformLogo';
import { fetchServerInfo, login as subsonicLogin } from '../services/subsonicService';
import { authStore } from '../store/authStore';
import { serverInfoStore } from '../store/serverInfoStore';

const PRIMARY = '#1D9BF0';

export function LoginScreen() {
  const router = useRouter();
  const isLoggedIn = authStore((s) => s.isLoggedIn);
  const setSession = authStore((s) => s.setSession);

  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (isLoggedIn) {
    return <Redirect href="/" />;
  }

  const handleSubmit = async () => {
    const url = serverUrl.trim();
    const user = username.trim();
    const pass = password;

    if (!url || !user || !pass) {
      setError('Please fill in all fields.');
      return;
    }
    setError(null);
    setLoading(true);

    const result = await subsonicLogin(url, user, pass);
    setLoading(false);

    if (result.success) {
      setSession(url, user, pass, result.version);
      const info = await fetchServerInfo();
      if (info) serverInfoStore.getState().setServerInfo(info);
      router.replace('/');
    } else {
      setError(result.error || 'Invalid server or credentials.');
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.inner}>
        {/* Logo */}
        <View style={styles.logoContainer}>
          <WaveformLogo size={80} color="#FFFFFF" />
        </View>

        <Text style={styles.title}>substreamer</Text>
        <Text style={styles.subtitle}>
          Sign in to your Subsonic server
        </Text>

        {/* Form */}
        <View>
          <TextInput
            style={styles.input}
            placeholder="Server address (e.g. https://demo.navidrome.org)"
            placeholderTextColor="rgba(255,255,255,0.85)"
            value={serverUrl}
            onChangeText={(t) => {
              setServerUrl(t);
              setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!loading}
          />
          <TextInput
            style={styles.input}
            placeholder="Username"
            placeholderTextColor="rgba(255,255,255,0.85)"
            value={username}
            onChangeText={(t) => {
              setUsername(t);
              setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />
          <TextInput
            style={[styles.input, styles.inputLast]}
            placeholder="Password"
            placeholderTextColor="rgba(255,255,255,0.85)"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              setError(null);
            }}
            secureTextEntry
            editable={!loading}
            returnKeyType="go"
            onSubmitEditing={handleSubmit}
          />

          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : null}

          {/* Submit button */}
          <Pressable
            style={({ pressed }) => [
              styles.button,
              loading && styles.buttonDisabled,
              pressed && !loading && styles.buttonPressed,
            ]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={PRIMARY} />
            ) : (
              <Text style={styles.buttonText}>Log in</Text>
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PRIMARY,
    justifyContent: 'center',
  },
  inner: {
    paddingHorizontal: 24,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginBottom: 28,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#FFFFFF',
    marginBottom: 12,
  },
  inputLast: {
    marginBottom: 4,
  },
  error: {
    fontSize: 14,
    color: '#FFEB3B',
    marginTop: 8,
    marginBottom: 4,
  },
  button: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: 24,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonPressed: {
    opacity: 0.9,
  },
  buttonText: {
    color: PRIMARY,
    fontSize: 16,
    fontWeight: '700',
  },
});
