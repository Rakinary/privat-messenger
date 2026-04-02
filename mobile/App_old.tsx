import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Alert,
  StyleSheet,
  FlatList,
  SafeAreaView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Animated,
  PanResponder,
  useWindowDimensions,
} from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = 'https://sic-their-personnel-upcoming.trycloudflare.com';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

type User = {
  id: string;
  username?: string;
  email?: string;
};

type Message = {
  id: string;
  text: string;
  senderId: string;
  sender?: User;
  createdAt?: string;
  createdAtLabel?: string;
};

type Member = {
  id: string;
  userId: string;
  role?: string;
  user?: User;
};

type Chat = {
  id: string;
  type?: string;
  title?: string | null;
  members?: Member[];
  messages?: Message[];
  createdAt?: string;
};

const STORAGE_TOKEN_KEY = 'pm_token';
const STORAGE_USER_ID_KEY = 'pm_user_id';
const STORAGE_EMAIL_KEY = 'pm_email';
const SWIPE_BACK_THRESHOLD = 90;
const EDGE_SWIPE_ZONE = 36;
const AUTO_REFRESH_CHATS_MS = 5000;
const AUTO_REFRESH_MESSAGES_MS = 2500;
const BOTTOM_OFFSET_TO_SHOW_SCROLL_BUTTON = 120;

export default function App() {
  const [bootLoading, setBootLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const [chats, setChats] = useState<Chat[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);

  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);

  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [composerHeight, setComposerHeight] = useState(62);

  const [currentChatTitle, setCurrentChatTitle] = useState('Чат');
  const [currentChatSubtitle, setCurrentChatSubtitle] = useState('был(а) недавно');

  const { height: windowHeight } = useWindowDimensions();

  const swipeX = useRef(new Animated.Value(0)).current;
  const listRef = useRef<FlatList<Message>>(null);

  const chatJustOpenedRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);

  const scrollToBottom = (animated = false) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated });
      });
    });
  };
  const handleMessagesScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
  const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
  const distanceFromBottom = Math.max(
    0,
    contentSize.height - (contentOffset.y + layoutMeasurement.height),
  );
  const isNearBottom = distanceFromBottom <= BOTTOM_OFFSET_TO_SHOW_SCROLL_BUTTON;

  shouldStickToBottomRef.current = isNearBottom;
  setShowScrollToBottom(!isNearBottom);
};

const handleComposerLayout = (event: LayoutChangeEvent) => {
  const nextHeight = Math.max(54, Math.ceil(event.nativeEvent.layout.height));
  setComposerHeight((prev) => (prev === nextHeight ? prev : nextHeight));
};

  const authHeaders = useMemo(
    () =>
      token
        ? {
            Authorization: `Bearer ${token}`,
          }
        : {},
    [token],
  );

  const formatMessageTime = (value?: string) => {
    if (!value) return '';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const normalizeMessages = (items: any[]): Message[] => {
    return items.map((item) => ({
      ...item,
      createdAtLabel: formatMessageTime(item?.createdAt),
    }));
  };

  const getChatDisplay = (chat: Chat) => {
    const otherUser = chat.members?.find((m) => m.user?.id !== myUserId)?.user;

    return {
      title: chat.title || otherUser?.username || 'Чат',
      subtitle: chat.messages?.[chat.messages.length - 1]?.text || 'Нет сообщений',
      avatarLetter: (chat.title || otherUser?.username || '?').charAt(0).toUpperCase(),
    };
  };

  const updateCurrentChatMeta = (chatId: string) => {
    const chat = chats.find((item) => item.id === chatId);
    if (!chat) {
      setCurrentChatTitle('Чат');
      setCurrentChatSubtitle('был(а) недавно');
      return;
    }

    const display = getChatDisplay(chat);
    setCurrentChatTitle(display.title);
    setCurrentChatSubtitle(chat.messages?.length ? 'в сети недавно' : 'был(а) недавно');
  };

  const closeChat = () => {
    Animated.timing(swipeX, {
      toValue: 400,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      swipeX.stopAnimation();
      swipeX.setValue(0);
      chatJustOpenedRef.current = false;
      setSelectedChatId(null);
      setMessageText('');
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: (_, gestureState) => {
        return selectedChatId !== null && gestureState.x0 <= EDGE_SWIPE_ZONE;
      },
      onMoveShouldSetPanResponderCapture: (_, gestureState) => {
        return (
          selectedChatId !== null &&
          gestureState.x0 <= EDGE_SWIPE_ZONE &&
          gestureState.dx > 10 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy)
        );
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx > 0) {
          swipeX.setValue(Math.min(gestureState.dx, 240));
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > SWIPE_BACK_THRESHOLD) {
          closeChat();
        } else {
          Animated.spring(swipeX, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(swipeX, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
      onShouldBlockNativeResponder: () => false,
    }),
  ).current;

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const savedToken = await AsyncStorage.getItem(STORAGE_TOKEN_KEY);
        const savedUserId = await AsyncStorage.getItem(STORAGE_USER_ID_KEY);
        const savedEmail = await AsyncStorage.getItem(STORAGE_EMAIL_KEY);

        if (savedEmail) setEmail(savedEmail);
        if (savedToken) setToken(savedToken);
        if (savedUserId) setMyUserId(savedUserId);
      } catch (e) {
        console.log('restoreSession error', e);
      } finally {
        setBootLoading(false);
      }
    };

    restoreSession();
  }, []);

  const handleLogin = async () => {
    if (loading) return;

    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (!trimmedEmail || !trimmedPassword) {
      Alert.alert('Ошибка', 'Введи email и пароль');
      return;
    }

    try {
      setLoading(true);

      const res = await api.post('/auth/login', {
        email: trimmedEmail,
        password: trimmedPassword,
      });

      const accessToken = res.data?.accessToken;
      const userId = res.data?.user?.id;

      if (!accessToken) {
        Alert.alert('Ошибка', 'Сервер не вернул accessToken');
        return;
      }

      setToken(accessToken);
      setMyUserId(userId || null);

      await AsyncStorage.setItem(STORAGE_TOKEN_KEY, accessToken);
      await AsyncStorage.setItem(STORAGE_EMAIL_KEY, trimmedEmail);
      if (userId) {
        await AsyncStorage.setItem(STORAGE_USER_ID_KEY, userId);
      }

      setPassword('');
    } catch (err: any) {
      console.log('login error', err?.response?.data || err?.message || err);
      Alert.alert(
        'Ошибка входа',
        err?.response?.data?.message || err?.message || 'Не удалось войти',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setToken(null);
    setMyUserId(null);
    setSelectedChatId(null);
    setMessages([]);
    setChats([]);
    setPassword('');
    setCurrentChatTitle('Чат');
    setCurrentChatSubtitle('был(а) недавно');

    await AsyncStorage.removeItem(STORAGE_TOKEN_KEY);
    await AsyncStorage.removeItem(STORAGE_USER_ID_KEY);
    setEmail('');
  };

  const loadChats = async () => {
    if (!token) return;

    try {
      setLoadingChats(true);
      const res = await api.get('/chats', { headers: authHeaders });
      setChats(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      console.log('loadChats error', err?.response?.data || err?.message || err);
      Alert.alert(
        'Ошибка загрузки',
        err?.response?.data?.message || err?.message || 'Не удалось получить чаты',
      );
    } finally {
      setLoadingChats(false);
    }
  };

  const loadMessages = async (
  chatId: string,
  options?: { keepBottom?: boolean; silent?: boolean; forceScrollToBottom?: boolean },
) => {
  if (!token) return;

  try {
    const res = await api.get(`/chats/${chatId}/messages`, {
      headers: authHeaders,
    });

    const nextMessages = Array.isArray(res.data) ? normalizeMessages(res.data) : [];
    setMessages(nextMessages);

    const shouldScrollNow =
      options?.forceScrollToBottom ||
      (options?.keepBottom !== false && shouldStickToBottomRef.current);

    if (shouldScrollNow && nextMessages.length > 0) {
      scrollToBottom(false);
    }
  } catch (err: any) {
    console.log('loadMessages error', err?.response?.data || err?.message || err);

    if (!options?.silent) {
      Alert.alert(
        'Ошибка загрузки сообщений',
        err?.response?.data?.message || err?.message || 'Не удалось получить сообщения',
      );
    }
  }
};

  const sendMessage = async () => {
    if (!token || !selectedChatId || !messageText.trim() || sending) return;

    try {
      setSending(true);

      await api.post(
        '/messages',
        {
          chatId: selectedChatId,
          text: messageText.trim(),
        },
        { headers: authHeaders },
      );

      setMessageText('');
      shouldStickToBottomRef.current = true;
      setShowScrollToBottom(false);
      await loadMessages(selectedChatId, { keepBottom: true, forceScrollToBottom: true });
      await loadChats();
    } catch (err: any) {
      console.log('sendMessage error', err?.response?.data || err?.message || err);
      Alert.alert(
        'Ошибка отправки',
        err?.response?.data?.message || err?.message || 'Не удалось отправить сообщение',
      );
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (!token) return;

    loadChats();

    const interval = setInterval(() => {
      loadChats();
    }, AUTO_REFRESH_CHATS_MS);

    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (!selectedChatId) return;

    shouldStickToBottomRef.current = true;
    setShowScrollToBottom(false);
    loadMessages(selectedChatId, { keepBottom: true, forceScrollToBottom: true });

    const interval = setInterval(() => {
      loadMessages(selectedChatId, { keepBottom: true, silent: true });
    }, AUTO_REFRESH_MESSAGES_MS);

    return () => clearInterval(interval);
  }, [selectedChatId, token]);

  useEffect(() => {
    if (!selectedChatId || messages.length === 0) return;

    if (chatJustOpenedRef.current) {
      scrollToBottom(false);
      chatJustOpenedRef.current = false;
      shouldStickToBottomRef.current = true;
      setShowScrollToBottom(false);
      return;
    }

    if (shouldStickToBottomRef.current) {
      scrollToBottom(false);
      setShowScrollToBottom(false);
    }
  }, [messages.length, selectedChatId]);

  useEffect(() => {
  if (!selectedChatId) return;

  const enoughSpaceForKeyboard =
    windowHeight > 0 && composerHeight < Math.max(180, windowHeight * 0.45);

  if (!enoughSpaceForKeyboard) {
    setComposerHeight(62);
  }
}, [windowHeight, composerHeight, selectedChatId]);

  if (bootLoading) {
    return (
      <SafeAreaView style={styles.loaderWrap}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </SafeAreaView>
    );
  }

  if (!token) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.authWrap}>
          <Text style={styles.title}>Private Messenger</Text>

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#888"
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
            spellCheck={false}
            textContentType="username"
            autoComplete="username"
            value={email}
            onChangeText={setEmail}
          />

          <TextInput
            style={styles.input}
            placeholder="Пароль"
            placeholderTextColor="#888"
            secureTextEntry
            autoCorrect={false}
            spellCheck={false}
            textContentType="password"
            autoComplete="password"
            value={password}
            onChangeText={setPassword}
          />

          <Pressable style={styles.button} onPress={handleLogin} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? 'Входим...' : 'Войти'}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (selectedChatId) {
    return (
      <SafeAreaView style={styles.container}>
        <Animated.View
          style={[styles.chatScreenWrap, { transform: [{ translateX: swipeX }] }]}
          {...panResponder.panHandlers}
        >
            <KeyboardAvoidingView
              style={styles.chatKeyboardWrap}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
              enabled
            >
            <View style={styles.chatTopBar}>
              <Pressable onPress={closeChat} style={styles.chatTopLeft}>
                <Text style={styles.chatBack}>‹</Text>
              </Pressable>

              <View style={styles.chatTopCenter}>
                <Text style={styles.chatTopTitle} numberOfLines={1}>
                  {currentChatTitle}
                </Text>
                <Text style={styles.chatTopSubtitle} numberOfLines={1}>
                  {currentChatSubtitle}
                </Text>
              </View>

              <View style={styles.chatTopRight}>
                <View style={styles.chatAvatarSmall}>
                  <Text style={styles.chatAvatarSmallText}>
                    {currentChatTitle.charAt(0).toUpperCase() || '?'}
                  </Text>
                </View>
              </View>
            </View>

            <FlatList
              ref={listRef}
              style={styles.messagesList}
              contentContainerStyle={[
                styles.messagesContent,
                { paddingBottom: composerHeight },
              ]}
              data={messages}
              keyExtractor={(item) => item.id}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              contentInsetAdjustmentBehavior="never"
              automaticallyAdjustContentInsets={false}
              maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 8 }}
              onScroll={handleMessagesScroll}
              scrollEventThrottle={16}
              onLayout={() => {
                if (selectedChatId && messages.length > 0 && shouldStickToBottomRef.current) {
                  scrollToBottom(false);
                }
              }}
              onContentSizeChange={() => {
                if (selectedChatId && messages.length > 0 && shouldStickToBottomRef.current) {
                  scrollToBottom(false);
                }
              }}
              renderItem={({ item }) => {
                const isMine = item.senderId === myUserId;

                return (
                  <View style={styles.messageRow}>
                    <View
                      style={[
                        styles.messageBubble,
                        isMine ? styles.myMessage : styles.otherMessage,
                      ]}
                    >
                      <Text style={styles.messageAuthor}>{item.sender?.username || 'User'}</Text>
                      <Text style={styles.messageText}>{item.text}</Text>
                      {!!item.createdAtLabel && (
                        <Text style={styles.messageTime}>{item.createdAtLabel}</Text>
                      )}
                    </View>
                  </View>
                );
              }}
              ListEmptyComponent={<Text style={styles.emptyText}>Сообщений пока нет</Text>}
            />
            {showScrollToBottom && (
              <Pressable
                style={[styles.scrollToBottomButton, { bottom: composerHeight + 14 }]}
                onPress={() => {
                  shouldStickToBottomRef.current = true;
                  setShowScrollToBottom(false);
                  scrollToBottom(true);
                }}
              >
                <Text style={styles.scrollToBottomButtonText}>↓</Text>
              </Pressable>
            )}

            <View style={styles.composerOuter} onLayout={handleComposerLayout}>
              <View style={styles.composerInner}>
                <Pressable style={styles.composerIconLeft}>
                  <Text style={styles.composerIconText}>＋</Text>
                </Pressable>

                <TextInput
                  style={styles.messageInput}
                  placeholder="Сообщение"
                  placeholderTextColor="#8f96a3"
                  value={messageText}
                  onChangeText={setMessageText}
                  autoCorrect
                  spellCheck
                  autoCapitalize="sentences"
                  keyboardAppearance="dark"
                  returnKeyType="send"
                  enablesReturnKeyAutomatically
                  onSubmitEditing={sendMessage}
                  blurOnSubmit={false}
                />

                <Pressable style={styles.composerIconRight}>
                  <Text style={styles.composerEmoji}>☺︎</Text>
                </Pressable>
              </View>

              <Pressable style={styles.sendButton} onPress={sendMessage} disabled={sending}>
                <Text style={styles.sendText}>{sending ? '...' : '➤'}</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </Animated.View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Чаты</Text>

        <Pressable onPress={handleLogout}>
          <Text style={styles.logout}>Выйти</Text>
        </Pressable>
      </View>

      <FlatList
        data={chats}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => {
          const display = getChatDisplay(item);

          return (
            <Pressable
              style={styles.chatCard}
                onPress={async () => {
                  updateCurrentChatMeta(item.id);
                  chatJustOpenedRef.current = true;
                  shouldStickToBottomRef.current = true;
                  setShowScrollToBottom(false);
                  setSelectedChatId(item.id);
                  setMessages([]);
                  swipeX.stopAnimation();
                  swipeX.setValue(0);
                  await loadMessages(item.id, {
                    keepBottom: true,
                    forceScrollToBottom: true,
                  });
                }}
            >
              <View style={styles.row}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{display.avatarLetter}</Text>
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.username}>{display.title}</Text>
                  <Text style={styles.lastMessage} numberOfLines={1}>
                    {display.subtitle}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text style={styles.emptyText}>Чатов пока нет</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  loaderWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  authWrap: {
    padding: 20,
    marginTop: 100,
  },
  title: {
    fontSize: 28,
    color: '#fff',
    marginBottom: 20,
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#1e293b',
    color: '#fff',
    padding: 14,
    borderRadius: 12,
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#2563eb',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
  },
  logout: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '600',
  },
  chatCard: {
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 16,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#2563eb',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  username: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  lastMessage: {
    color: '#94a3b8',
    marginTop: 4,
    fontSize: 14,
  },
  messagesList: {
    flex: 1,
    backgroundColor: '#0b1736',
  },
  messagesContent: {
    paddingHorizontal: 12,
    paddingTop: 0,
    flexGrow: 1,
  },
  scrollToBottomButton: {
  position: 'absolute',
  right: 16,
  width: 40,
  height: 40,
  borderRadius: 20,
  backgroundColor: '#1e40af',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 20,
  elevation: 6,
  shadowColor: '#000',
  shadowOpacity: 0.2,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 3 },
},
scrollToBottomButtonText: {
  color: '#fff',
  fontSize: 20,
  fontWeight: '700',
  marginTop: -2,
},
  messageRow: {
    width: '100%',
    marginBottom: 2,
  },
  messageBubble: {
    padding: 12,
    borderRadius: 16,
    marginBottom: 8,
    maxWidth: '82%',
    minWidth: 96,
    paddingBottom: 8,
  },
  myMessage: {
    backgroundColor: '#2563eb',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 6,
  },
  otherMessage: {
    backgroundColor: '#1e293b',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 6,
  },
  messageAuthor: {
    color: '#cbd5e1',
    fontSize: 11,
    marginBottom: 4,
    fontWeight: '600',
  },
  messageText: {
    color: '#fff',
    fontSize: 16,
  },
  messageTime: {
    color: '#cbd5e1',
    fontSize: 10,
    marginTop: 6,
    alignSelf: 'flex-end',
    opacity: 0.75,
  },
  sendButton: {
    backgroundColor: '#2563eb',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 1,
  },
  emptyText: {
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 40,
    fontSize: 16,
  },
  chatScreenWrap: {
    flex: 1,
    backgroundColor: '#0b1736',
  },
  chatKeyboardWrap: {
  flex: 1,
},
  chatTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: '#0f172a',
  },
  chatTopLeft: {
    width: 52,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  chatBack: {
    color: '#60a5fa',
    fontSize: 34,
    lineHeight: 34,
    fontWeight: '400',
  },
  chatTopCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  chatTopTitle: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '700',
  },
  chatTopSubtitle: {
    color: '#9ca3af',
    fontSize: 13,
    marginTop: 1,
  },
  chatTopRight: {
    width: 52,
    alignItems: 'flex-end',
  },
  chatAvatarSmall: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#2563eb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatAvatarSmallText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  composerOuter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
    backgroundColor: '#0f172a',
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  composerInner: {
    flex: 1,
    minHeight: 46,
    backgroundColor: '#1e293b',
    borderRadius: 23,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  composerIconLeft: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  composerIconRight: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  composerIconText: {
    color: '#94a3b8',
    fontSize: 24,
    lineHeight: 24,
  },
  composerEmoji: {
    color: '#94a3b8',
    fontSize: 18,
  },
  messageInput: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    paddingVertical: 11,
    paddingHorizontal: 8,
    minHeight: 46,
  },
});
