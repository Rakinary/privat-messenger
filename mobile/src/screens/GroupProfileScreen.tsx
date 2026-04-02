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
import type { Chat, RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'GroupProfile'>;

export default function GroupProfileScreen({ route, navigation }: Props) {
  const { token } = useAuth();
  const [chat, setChat] = useState<Chat | null>(null);
  const [loading, setLoading] = useState(true);
  const appear = useRef(new Animated.Value(0)).current;

  const loadChat = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get(`/chats/${route.params.chatId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setChat(res.data ?? null);
    } catch (err: any) {
      Alert.alert(
        'Could not load group profile',
        err?.response?.data?.message || err?.message || 'Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }, [route.params.chatId, token]);

  useEffect(() => {
    loadChat();
  }, [loadChat]);

  useEffect(() => {
    Animated.timing(appear, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [appear]);

  const memberCount = useMemo(() => chat?.members?.length ?? 0, [chat?.members?.length]);

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
          <Text style={styles.headerTitle}>Group profile</Text>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCard}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>{(chat?.title?.slice(0, 1) || 'G').toUpperCase()}</Text>
            </View>
            <Text style={styles.groupTitle}>{chat?.title || 'Loading...'}</Text>
            <Text style={styles.groupSubtitle}>{memberCount} members</Text>
          </View>

          <View style={styles.membersCard}>
            <Text style={styles.sectionTitle}>Participants</Text>
            {loading ? (
              <>
                <View style={styles.skeletonRow} />
                <View style={styles.skeletonRow} />
                <View style={styles.skeletonRow} />
              </>
            ) : (
              (chat?.members ?? []).map((member) => (
                <Pressable
                  key={member.id}
                  style={styles.memberRow}
                  onPress={() => {
                    const memberUserId = member.user?.id ?? member.userId;
                    if (!memberUserId) {
                      return;
                    }

                    navigation.navigate('UserProfile', { userId: memberUserId });
                  }}
                >
                  <View style={styles.memberAvatar}>
                    <Text style={styles.memberAvatarText}>
                      {(member.user?.username?.slice(0, 1) || member.user?.email?.slice(0, 1) || '?').toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{member.user?.username || 'User'}</Text>
                    <Text style={styles.memberMeta}>{member.role || 'MEMBER'}</Text>
                  </View>
                  <Text style={styles.memberAction}>Open</Text>
                </Pressable>
              ))
            )}
          </View>
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
  heroBadge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#2d6cdf',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroBadgeText: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '800',
  },
  groupTitle: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
  },
  groupSubtitle: {
    color: '#97afd4',
    marginTop: 6,
  },
  membersCard: {
    backgroundColor: '#0f213f',
    borderWidth: 1,
    borderColor: '#1e335d',
    borderRadius: 24,
    padding: 18,
    gap: 12,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 4,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#132645',
    borderWidth: 1,
    borderColor: '#223d69',
    borderRadius: 18,
    padding: 12,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#214889',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  memberAvatarText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 18,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  memberMeta: {
    color: '#8ea4c7',
    fontSize: 12,
    marginTop: 4,
  },
  memberAction: {
    color: '#83b7ff',
    fontWeight: '700',
  },
  skeletonRow: {
    height: 68,
    borderRadius: 18,
    backgroundColor: '#173055',
  },
});