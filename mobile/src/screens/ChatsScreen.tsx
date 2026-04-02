import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../api/client';
import { formatTime, getChatTitle, getInitials, getLastMessage } from '../utils/chat';
import { useAuth } from '../contexts/AuthContext';
import type { Chat, RootStackParamList, SessionUser } from '../types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<RootStackParamList, 'Chats'>;

export default function ChatsScreen({ navigation }: Props) {
  const { token, userId, logout } = useAuth();

  if (!userId) return null;
  const [chats, setChats] = useState<Chat[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SessionUser[]>([]);
  const [searching, setSearching] = useState(false);
  
  const loadChats = useCallback(async () => {
    try {
      setRefreshing(true);
      const res = await api.get('/chats', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setChats(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      Alert.alert(
        'Could not load chats',
        err?.response?.data?.message || err?.message || 'Please try again.',
      );
    } finally {
      setRefreshing(false);
    }
  }, [token]);

const searchUsers = async () => {
  if (!token) return;

  const value = search.trim();

  if (!value) {
    setSearchResults([]);
    return;
  }

  try {
    setSearching(true);

    const res = await api.get('/users', {
      headers: { Authorization: `Bearer ${token}` },
      params: { query: value },
    });

    setSearchResults(Array.isArray(res.data) ? res.data : []);
  } catch (err: any) {
    console.log('searchUsers error', err?.response?.data || err?.message || err);
    Alert.alert(
      'Ошибка поиска',
      err?.response?.data?.message || err?.message || 'Не удалось найти пользователей',
    );
  } finally {
    setSearching(false);
  }
};

const startDirectChat = async (otherUserId: string) => {
  if (!token) return;

  try {
    const res = await api.post(
      '/chats/direct',
      { otherUserId },
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const chat = res.data;

    setSearch('');
    setSearchResults([]);

    await loadChats();

    if (chat?.id) {
      navigation.navigate('Chat', { chatId: chat.id, title: getChatTitle(chat, userId) });
    }
  } catch (err: any) {
    console.log('startDirectChat error', err?.response?.data || err?.message || err);
    Alert.alert(
      'Ошибка',
      err?.response?.data?.message || err?.message || 'Не удалось создать чат',
    );
  }
};

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Chats</Text>
            <Text style={styles.subtitle}>Your private conversations</Text>
          </View>
          <Pressable onPress={logout}>
            <Text style={styles.logout}>Sign out</Text>
          </Pressable>
        </View>

<View style={styles.searchWrap}>
  <TextInput
    style={styles.searchInput}
    placeholder="Поиск по username"
    placeholderTextColor="#888"
    autoCapitalize="none"
    autoCorrect={false}
    spellCheck={false}
    value={search}
    onChangeText={setSearch}
    onSubmitEditing={searchUsers}
    returnKeyType="search"
  />

  <Pressable
    style={styles.searchButton}
    onPress={searchUsers}
    disabled={searching}
  >
    <Text style={styles.searchButtonText}>
      {searching ? '...' : 'Search'}
    </Text>
  </Pressable>
</View>

{searchResults.length > 0 && (
  <View style={styles.searchResults}>
    {searchResults.map((user) => (
      <Pressable
        key={user.id}
        style={styles.searchUserCard}
        onPress={() => startDirectChat(user.id)}
      >
        <Text style={styles.searchUsername}>
          @{user.username || user.email || 'user'}
        </Text>
        {!!user.email && (
          <Text style={styles.searchEmail}>{user.email}</Text>
        )}
      </Pressable>
    ))}
  </View>
)}

        <FlatList
          data={chats}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadChats} tintColor="#fff" />}
          renderItem={({ item }) => {
            const title = getChatTitle(item, userId);
            const lastMessage = getLastMessage(item);
            const lastTime = formatTime(item.messages?.[item.messages.length - 1]?.createdAt || item.createdAt);
            const lastMsgSender = item.messages?.[item.messages.length - 1]?.senderId;
            const isLastMine = lastMsgSender === userId;
            const previewText = lastMessage ? (isLastMine ? `You: ${lastMessage}` : lastMessage) : 'No messages yet';

            return (
              <Pressable
                style={styles.chatCard}
                onPress={() => navigation.navigate('Chat', { chatId: item.id, title })}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{getInitials(title)}</Text>
                </View>

                <View style={styles.chatBody}>
                  <View style={styles.topRow}>
                    <Text style={styles.chatName} numberOfLines={1}>{title}</Text>
                    <Text style={styles.time}>{lastTime}</Text>
                  </View>
                  <Text style={styles.preview} numberOfLines={1}>{previewText}</Text>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>No chats yet</Text>
              <Text style={styles.emptySubtitle}>Create a direct chat from the backend first, then pull to refresh here.</Text>
            </View>
          }
          contentContainerStyle={chats.length === 0 ? styles.emptyContainer : { paddingBottom: 20 }}
        />
      </View>
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
    paddingHorizontal: 16,
  },
  header: {
    paddingTop: 8,
    paddingBottom: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '800',
  },
  subtitle: {
    color: '#8ea4c7',
    marginTop: 4,
  },
  logout: {
    color: '#9ec2ff',
    fontSize: 15,
    fontWeight: '700',
  },
  chatCard: {
    backgroundColor: '#0f213f',
    borderWidth: 1,
    borderColor: '#1e335d',
    borderRadius: 22,
    padding: 14,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#2d6cdf',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 20,
  },
  chatBody: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  chatName: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
    marginRight: 12,
  },
  time: {
    color: '#7f95bc',
    fontSize: 12,
  },
  preview: {
    color: '#9eb0d1',
    fontSize: 14,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyWrap: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: '#8ea4c7',
    textAlign: 'center',
    lineHeight: 20,
  },

  searchWrap: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#1e293b',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
  },
  searchButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  searchResults: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  searchUserCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  searchUsername: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  searchEmail: {
    color: '#94a3b8',
    marginTop: 4,
    fontSize: 13,
  },  
});
