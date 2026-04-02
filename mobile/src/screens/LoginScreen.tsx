import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../api/client';
import type { SessionUser } from '../types';

type Props = {
  onLogin: (token: string, user: SessionUser) => void;
};

export default function LoginScreen({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(appear, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [appear]);

  const handleLogin = async () => {
    try {
      setLoading(true);
      const res = await api.post('/auth/login', { email, password });
      const token = res.data?.accessToken as string | undefined;
      const user = res.data?.user as SessionUser | undefined;

      if (!token || !user) {
        Alert.alert('Login failed', 'Server did not return a valid session.');
        return;
      }

      onLogin(token, user);
    } catch (err: any) {
      Alert.alert(
        'Login failed',
        err?.response?.data?.message || err?.message || 'Could not sign in.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View
          style={[
            styles.logoWrap,
            {
              opacity: appear,
              transform: [
                {
                  translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }),
                },
              ],
            },
          ]}
        >
          <View style={styles.logoFrame}>
            <Image source={require('../../assets/logo.png')} style={styles.logoImage} resizeMode="contain" />
          </View>
          <Text style={styles.title}>Private Messenger</Text>
          <Text style={styles.subtitle}>Fast, self-hosted, clean.</Text>
        </Animated.View>

        <Animated.View
          style={[
            styles.card,
            {
              opacity: appear,
              transform: [
                {
                  translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }),
                },
              ],
            },
          ]}
        >
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor="#7f8daa"
            value={email}
            onChangeText={setEmail}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#7f8daa"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <Pressable style={styles.button} onPress={handleLogin} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? 'Signing in…' : 'Sign in'}</Text>
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#07152b',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoFrame: {
    width: 110,
    height: 110,
    borderRadius: 26,
    backgroundColor: '#0f213f',
    borderWidth: 1,
    borderColor: '#2b406b',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    shadowColor: '#061127',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  logoImage: {
    width: 84,
    height: 84,
  },
  title: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '800',
  },
  subtitle: {
    color: '#8da1c4',
    fontSize: 15,
    marginTop: 6,
  },
  card: {
    backgroundColor: '#0f213f',
    borderWidth: 1,
    borderColor: '#1e335d',
    borderRadius: 24,
    padding: 18,
  },
  label: {
    color: '#b9caea',
    marginBottom: 8,
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#12284c',
    borderWidth: 1,
    borderColor: '#24406c',
    color: '#fff',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  button: {
    marginTop: 18,
    backgroundColor: '#2d6cdf',
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
  },
});
