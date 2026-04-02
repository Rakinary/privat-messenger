import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import type { ChatUser, RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'UserProfile'>;

function formatDate(value?: string) {
  if (!value) {
    return 'Unknown';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return date.toLocaleString();
}

export default function UserProfileScreen({ route, navigation }: Props) {
  const { token, userId } = useAuth();
  const [profile, setProfile] = useState<ChatUser | null>(null);
  const [loading, setLoading] = useState(true);
  const appear = useRef(new Animated.Value(0)).current;

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get(`/users/${route.params.userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setProfile(res.data ?? null);
    } catch (err: any) {
      Alert.alert(
        'Could not load profile',
        err?.response?.data?.message || err?.message || 'Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }, [route.params.userId, token]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    Animated.timing(appear, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [appear]);

  const initials = useMemo(() => {
    return (profile?.username?.slice(0, 1) || profile?.email?.slice(0, 1) || '?').toUpperCase();
  }, [profile?.email, profile?.username]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <Animated.View
        style={[
          styles.container,
          {
            opacity: appear,
            transform: [
              {
                translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }),
              },
            ],
          },
        ]}
      >
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <Text style={styles.headerTitle}>{route.params.userId === userId ? 'My profile' : 'Profile'}</Text>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <Text style={styles.username}>{profile?.username || 'Loading...'}</Text>
            <Text style={styles.email}>{profile?.email || ' '}</Text>
          </View>

          {loading ? (
            <View style={styles.sectionCard}>
              <View style={styles.skeletonLineWide} />
              <View style={styles.skeletonLine} />
              <View style={styles.skeletonLine} />
            </View>
          ) : (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Account info</Text>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Username</Text>
                <Text style={styles.infoValue}>@{profile?.username || 'unknown'}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Email</Text>
                <Text style={styles.infoValue}>{profile?.email || 'Unknown'}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Created</Text>
                <Text style={styles.infoValue}>{formatDate(profile?.createdAt)}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Last seen</Text>
                <Text style={styles.infoValue}>{formatDate(profile?.lastSeenAt)}</Text>
              </View>
            </View>
          )}
        </ScrollView>
      </Animated.View>
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
    backgroundColor: '#07152b',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
  },
  backButton: {
    marginRight: 12,
  },
  backText: {
    color: '#60a5fa',
    fontSize: 34,
    lineHeight: 34,
    fontWeight: '400',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  heroCard: {
    backgroundColor: '#0f213f',
    borderWidth: 1,
    borderColor: '#1e335d',
    borderRadius: 28,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#2d6cdf',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  avatarText: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '800',
  },
  username: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800',
  },
  email: {
    color: '#9ab2d8',
    marginTop: 6,
  },
  sectionCard: {
    backgroundColor: '#0f213f',
    borderWidth: 1,
    borderColor: '#1e335d',
    borderRadius: 24,
    padding: 18,
    gap: 14,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
  },
  infoRow: {
    gap: 6,
  },
  infoLabel: {
    color: '#88a0c6',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  infoValue: {
    color: '#f6f9ff',
    fontSize: 15,
  },
  skeletonLineWide: {
    height: 16,
    width: '55%',
    borderRadius: 8,
    backgroundColor: '#173055',
  },
  skeletonLine: {
    height: 12,
    width: '82%',
    borderRadius: 6,
    backgroundColor: '#173055',
  },
});