import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { io } from 'socket.io-client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { api, API_URL } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import type { Chat, RootStackParamList, SessionUser } from '../types';
import { formatTime, getChatTitle, getInitials, getLastMessage } from '../utils/chat';

type Props = NativeStackScreenProps<RootStackParamList, 'Chats'>;

const SEARCH_TRIGGER_LENGTH = 3;
const SEARCH_DEBOUNCE_MS = 350;

export default function ChatsScreen({ navigation }: Props) {
  const { token, userId, logout } = useAuth();
  const appear = useRef(new Animated.Value(0)).current;
  const [chats, setChats] = useState<Chat[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SessionUser[]>([]);
  const [searching, setSearching] = useState(false);

  const [isGroupModalVisible, setIsGroupModalVisible] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [groupSearchResults, setGroupSearchResults] = useState<SessionUser[]>([]);
  const [groupSearching, setGroupSearching] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<SessionUser[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);

  const loadChats = useCallback(async () => {
    if (!token) {
      setChats([]);
      setInitialLoading(false);
      return;
    }

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
      setInitialLoading(false);
    }
  }, [token]);

  const searchUsers = useCallback(
    async (query: string) => {
      if (!token) {
        return [] as SessionUser[];
      }

      const res = await api.get('/users', {
        headers: { Authorization: `Bearer ${token}` },
        params: { query },
      });

      return Array.isArray(res.data) ? (res.data as SessionUser[]) : [];
    },
    [token],
  );

  const resetGroupComposer = useCallback(() => {
    setGroupTitle('');
    setGroupSearch('');
    setGroupSearchResults([]);
    setSelectedMembers([]);
    setGroupSearching(false);
    setCreatingGroup(false);
  }, []);

  const closeGroupModal = useCallback(() => {
    setIsGroupModalVisible(false);
    resetGroupComposer();
  }, [resetGroupComposer]);

  const startDirectChat = useCallback(
    async (otherUserId: string) => {
      if (!token || !userId) {
        return;
      }

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
    },
    [loadChats, navigation, token, userId],
  );

  const toggleGroupMember = useCallback((member: SessionUser) => {
    setSelectedMembers((current) => {
      const exists = current.some((item) => item.id === member.id);
      if (exists) {
        return current.filter((item) => item.id !== member.id);
      }

      return [...current, member];
    });
  }, []);

  const createGroupChat = useCallback(async () => {
    const trimmedTitle = groupTitle.trim();

    if (!token || !userId) {
      return;
    }

    if (!trimmedTitle) {
      Alert.alert('Название группы', 'Введите название группы.');
      return;
    }

    if (selectedMembers.length === 0) {
      Alert.alert('Участники', 'Добавьте хотя бы одного участника.');
      return;
    }

    try {
      setCreatingGroup(true);

      const res = await api.post(
        '/chats/group',
        {
          title: trimmedTitle,
          memberIds: selectedMembers.map((member) => member.id),
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      const chat = res.data;

      closeGroupModal();
      await loadChats();

      if (chat?.id) {
        navigation.navigate('Chat', { chatId: chat.id, title: getChatTitle(chat, userId) });
      }
    } catch (err: any) {
      console.log('createGroupChat error', err?.response?.data || err?.message || err);
      Alert.alert(
        'Ошибка',
        err?.response?.data?.message || err?.message || 'Не удалось создать группу',
      );
    } finally {
      setCreatingGroup(false);
    }
  }, [closeGroupModal, groupTitle, loadChats, navigation, selectedMembers, token, userId]);

  useEffect(() => {
    Animated.timing(appear, {
      toValue: 1,
      duration: 320,
      useNativeDriver: true,
    }).start();
  }, [appear]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  useFocusEffect(
    useCallback(() => {
      loadChats();
    }, [loadChats]),
  );

  useEffect(() => {
    if (!token) {
      return;
    }

    const socket = io(API_URL, {
      auth: { token },
      transports: ['websocket'],
    });
    const refreshChats = () => {
      loadChats();
    };

    socket.on('message:new', refreshChats);

    return () => {
      socket.off('message:new', refreshChats);
      socket.disconnect();
    };
  }, [loadChats, token]);

  useEffect(() => {
    const value = search.trim();

    if (!token || value.length < SEARCH_TRIGGER_LENGTH) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    let active = true;
    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const results = await searchUsers(value);
        if (!active) {
          return;
        }

        setSearchResults(results.filter((item) => item.id !== userId));
      } catch (err: any) {
        if (!active) {
          return;
        }

        console.log('searchUsers error', err?.response?.data || err?.message || err);
        setSearchResults([]);
      } finally {
        if (active) {
          setSearching(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search, searchUsers, token, userId]);

  useEffect(() => {
    const value = groupSearch.trim();

    if (!token || value.length < SEARCH_TRIGGER_LENGTH || !isGroupModalVisible) {
      setGroupSearchResults([]);
      setGroupSearching(false);
      return;
    }

    let active = true;
    setGroupSearching(true);

    const timer = setTimeout(async () => {
      try {
        const results = await searchUsers(value);
        if (!active) {
          return;
        }

        setGroupSearchResults(
          results.filter(
            (item) =>
              item.id !== userId && !selectedMembers.some((member) => member.id === item.id),
          ),
        );
      } catch (err: any) {
        if (!active) {
          return;
        }

        console.log('groupSearch error', err?.response?.data || err?.message || err);
        setGroupSearchResults([]);
      } finally {
        if (active) {
          setGroupSearching(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [groupSearch, isGroupModalVisible, searchUsers, selectedMembers, token, userId]);

  const trimmedSearch = search.trim();
  const trimmedGroupSearch = groupSearch.trim();

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
          <View>
            <Text style={styles.title}>Chats</Text>
            <Text style={styles.subtitle}>Direct messages and group conversations</Text>
          </View>
          <Pressable onPress={logout}>
            <Text style={styles.logout}>Sign out</Text>
          </Pressable>
        </View>

        <View style={styles.actionsRow}>
          <View style={styles.actionButtonsRow}>
          <Pressable
            style={[styles.groupButton, styles.secondaryActionButton]}
            onPress={() => {
              if (!userId) {
                return;
              }

              navigation.navigate('UserProfile', { userId });
            }}
          >
            <Text style={styles.groupButtonText}>My profile</Text>
          </Pressable>
          <Pressable style={styles.groupButton} onPress={() => setIsGroupModalVisible(true)}>
            <Text style={styles.groupButtonText}>New group</Text>
          </Pressable>
          </View>
        </View>

        <View style={styles.searchSection}>
          <Text style={styles.sectionLabel}>Find people</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Type at least 3 characters"
            placeholderTextColor="#7f8fb0"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            value={search}
            onChangeText={setSearch}
          />

          {trimmedSearch.length > 0 && trimmedSearch.length < SEARCH_TRIGGER_LENGTH && (
            <Text style={styles.helperText}>Search starts automatically after 3 characters.</Text>
          )}

          {searching && <Text style={styles.helperText}>Searching users...</Text>}

          {searchResults.length > 0 && (
            <View style={styles.searchResults}>
              {searchResults.map((item) => (
                <Pressable
                  key={item.id}
                  style={styles.searchUserCard}
                  onPress={() => startDirectChat(item.id)}
                >
                  <View>
                    <Text style={styles.searchUsername}>@{item.username || item.email || 'user'}</Text>
                    {!!item.email && <Text style={styles.searchEmail}>{item.email}</Text>}
                  </View>
                  <Text style={styles.searchAction}>Open</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {initialLoading ? (
          <View style={styles.skeletonList}>
            {Array.from({ length: 6 }).map((_, index) => (
              <View key={`chat-skeleton-${index}`} style={styles.skeletonCard}>
                <View style={styles.skeletonAvatar} />
                <View style={styles.skeletonBody}>
                  <View style={styles.skeletonTitle} />
                  <View style={styles.skeletonLine} />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <FlatList
            data={chats}
            keyExtractor={(item) => item.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadChats} tintColor="#fff" />}
            renderItem={({ item }) => {
              const title = userId ? getChatTitle(item, userId) : item.title || 'Chat';
              const lastMessage = getLastMessage(item);
              const lastTime = formatTime(item.messages?.[item.messages.length - 1]?.createdAt || item.createdAt);
              const lastMsgSender = item.messages?.[item.messages.length - 1]?.senderId;
              const isLastMine = lastMsgSender === userId;
              const previewText = lastMessage ? (isLastMine ? `You: ${lastMessage}` : lastMessage) : 'No messages yet';
              const unreadCount = item.unreadCount ?? 0;

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
                      <View style={styles.metaColumn}>
                        <Text style={[styles.time, unreadCount > 0 ? styles.timeUnread : null]}>{lastTime}</Text>
                        {unreadCount > 0 && (
                          <View style={styles.unreadBadge}>
                            <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                          </View>
                        )}
                      </View>
                    </View>
                    <Text style={[styles.preview, unreadCount > 0 ? styles.previewUnread : null]} numberOfLines={1}>{previewText}</Text>
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyTitle}>No chats yet</Text>
                <Text style={styles.emptySubtitle}>Start a direct chat from search or create your first group.</Text>
              </View>
            }
            contentContainerStyle={chats.length === 0 ? styles.emptyContainer : styles.listContent}
          />
        )}
      </Animated.View>

      <Modal
        visible={isGroupModalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeGroupModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Create group</Text>
                <Text style={styles.modalSubtitle}>Add a title and select participants.</Text>
              </View>
              <Pressable onPress={closeGroupModal}>
                <Text style={styles.modalClose}>Close</Text>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalContent}>
              <Text style={styles.sectionLabel}>Group name</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Weekend plans"
                placeholderTextColor="#7f8fb0"
                value={groupTitle}
                onChangeText={setGroupTitle}
                maxLength={80}
              />

              <Text style={styles.sectionLabel}>Add participants</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Search by username"
                placeholderTextColor="#7f8fb0"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                value={groupSearch}
                onChangeText={setGroupSearch}
              />

              {trimmedGroupSearch.length > 0 && trimmedGroupSearch.length < SEARCH_TRIGGER_LENGTH && (
                <Text style={styles.helperText}>Type 3 or more characters to search.</Text>
              )}

              {selectedMembers.length > 0 && (
                <View style={styles.selectedWrap}>
                  {selectedMembers.map((member) => (
                    <Pressable
                      key={member.id}
                      style={styles.memberChip}
                      onPress={() => toggleGroupMember(member)}
                    >
                      <Text style={styles.memberChipText}>@{member.username}</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {groupSearching && <Text style={styles.helperText}>Searching users...</Text>}

              {groupSearchResults.length > 0 && (
                <View style={styles.searchResults}>
                  {groupSearchResults.map((item) => (
                    <Pressable
                      key={item.id}
                      style={styles.searchUserCard}
                      onPress={() => toggleGroupMember(item)}
                    >
                      <View>
                        <Text style={styles.searchUsername}>@{item.username || item.email || 'user'}</Text>
                        {!!item.email && <Text style={styles.searchEmail}>{item.email}</Text>}
                      </View>
                      <Text style={styles.searchAction}>Add</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </ScrollView>

            <Pressable
              style={[
                styles.createButton,
                (!groupTitle.trim() || selectedMembers.length === 0 || creatingGroup) && styles.createButtonDisabled,
              ]}
              onPress={createGroupChat}
              disabled={!groupTitle.trim() || selectedMembers.length === 0 || creatingGroup}
            >
              <Text style={styles.createButtonText}>
                {creatingGroup ? 'Creating group...' : `Create group${selectedMembers.length ? ` (${selectedMembers.length})` : ''}`}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  actionsRow: {
    paddingBottom: 14,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  groupButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#16315d',
    borderWidth: 1,
    borderColor: '#2c5fb0',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  secondaryActionButton: {
    backgroundColor: '#102443',
    borderColor: '#24406c',
  },
  groupButtonText: {
    color: '#dce9ff',
    fontSize: 15,
    fontWeight: '700',
  },
  searchSection: {
    paddingBottom: 14,
  },
  sectionLabel: {
    color: '#dbe7ff',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  helperText: {
    color: '#90a4c9',
    fontSize: 13,
    marginTop: 8,
  },
  searchInput: {
    backgroundColor: '#132645',
    borderWidth: 1,
    borderColor: '#223d69',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
  },
  searchResults: {
    paddingTop: 10,
    gap: 8,
  },
  searchUserCard: {
    backgroundColor: '#0f213f',
    borderWidth: 1,
    borderColor: '#1e335d',
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  searchAction: {
    color: '#7fb0ff',
    fontSize: 14,
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
    alignItems: 'flex-start',
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
  timeUnread: {
    color: '#73b4ff',
  },
  metaColumn: {
    alignItems: 'flex-end',
    gap: 6,
  },
  preview: {
    color: '#9eb0d1',
    fontSize: 14,
  },
  previewUnread: {
    color: '#f6f9ff',
    fontWeight: '700',
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 11,
    backgroundColor: '#2d6cdf',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  skeletonList: {
    paddingTop: 6,
    gap: 12,
  },
  skeletonCard: {
    backgroundColor: '#0f213f',
    borderWidth: 1,
    borderColor: '#1e335d',
    borderRadius: 22,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  skeletonAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#1a355f',
    marginRight: 14,
  },
  skeletonBody: {
    flex: 1,
    gap: 10,
  },
  skeletonTitle: {
    width: '48%',
    height: 14,
    borderRadius: 7,
    backgroundColor: '#1a355f',
  },
  skeletonLine: {
    width: '84%',
    height: 11,
    borderRadius: 6,
    backgroundColor: '#173055',
  },
  listContent: {
    paddingBottom: 20,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(3, 10, 20, 0.72)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#07152b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 24,
    minHeight: '72%',
    maxHeight: '88%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
  },
  modalSubtitle: {
    color: '#8ea4c7',
    marginTop: 4,
  },
  modalClose: {
    color: '#9ec2ff',
    fontWeight: '700',
  },
  modalContent: {
    paddingBottom: 16,
  },
  selectedWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 12,
  },
  memberChip: {
    backgroundColor: '#173462',
    borderWidth: 1,
    borderColor: '#2f61b4',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  memberChipText: {
    color: '#e8f0ff',
    fontWeight: '700',
  },
  createButton: {
    marginTop: 10,
    backgroundColor: '#2563eb',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButtonDisabled: {
    backgroundColor: '#27457f',
  },
  createButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
});