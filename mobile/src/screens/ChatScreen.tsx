import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import {
  Alert,
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { io, Socket } from 'socket.io-client';
import { api, API_URL } from '../api/client';
import { formatTime } from '../utils/chat';
import { useAuth } from '../contexts/AuthContext';
import type { Chat, ChatMessage, RootStackParamList } from '../types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

const QUICK_REACTIONS = ['❤️', '👍', '😂', '😮', '🔥'] as const;
const MESSAGE_PAGE_SIZE = 50;

type ChatReceipt = {
  chatId: string;
  userId: string;
  lastDeliveredAt: string | null;
  lastReadAt: string | null;
};

type MessageReceiptEntry = {
  userId: string;
  username: string;
  status: 'sent' | 'delivered' | 'read';
  lastDeliveredAt: string | null;
  lastReadAt: string | null;
};

function mergeMessage(prev: ChatMessage[], updated: ChatMessage) {
  const existingIndex = prev.findIndex((message) => message.id === updated.id);
  if (existingIndex === -1) {
    return [...prev, updated];
  }

  const next = [...prev];
  next[existingIndex] = updated;
  return next;
}

function groupReactions(likes: ChatMessage['likes'], currentUserId: string | null) {
  const grouped = new Map<string, { emoji: string; count: number; reactedByMe: boolean }>();

  for (const like of likes ?? []) {
    const existing = grouped.get(like.emoji) ?? {
      emoji: like.emoji,
      count: 0,
      reactedByMe: false,
    };
    existing.count += 1;
    existing.reactedByMe = existing.reactedByMe || like.user.id === currentUserId;
    grouped.set(like.emoji, existing);
  }

  return Array.from(grouped.values());
}

function getTimestamp(value?: string | null) {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function applyReceiptToChat(prev: Chat | null, receipt: ChatReceipt) {
  if (!prev || prev.id !== receipt.chatId || !prev.members) {
    return prev;
  }

  return {
    ...prev,
    members: prev.members.map((member) => {
      const memberUserId = member.user?.id ?? member.userId;
      if (memberUserId !== receipt.userId) {
        return member;
      }

      return {
        ...member,
        lastDeliveredAt: receipt.lastDeliveredAt ?? member.lastDeliveredAt,
        lastReadAt: receipt.lastReadAt ?? member.lastReadAt,
      };
    }),
  };
}

function getMessageReceiptEntries(message: ChatMessage | null, chat: Chat | null) {
  if (!message?.createdAt || !chat?.members) {
    return [] as MessageReceiptEntry[];
  }

  const createdAt = getTimestamp(message.createdAt);

  return chat.members
    .map((member) => {
      const memberUserId = member.user?.id ?? member.userId;
      if (!memberUserId || memberUserId === message.senderId) {
        return null;
      }

      const lastReadAt = member.lastReadAt ?? null;
      const lastDeliveredAt = member.lastDeliveredAt ?? null;
      const readTimestamp = getTimestamp(lastReadAt);
      const deliveredTimestamp = getTimestamp(lastDeliveredAt);

      let status: MessageReceiptEntry['status'] = 'sent';
      if (readTimestamp >= createdAt) {
        status = 'read';
      } else if (deliveredTimestamp >= createdAt) {
        status = 'delivered';
      }

      return {
        userId: memberUserId,
        username: member.user?.username || member.user?.email || 'User',
        status,
        lastDeliveredAt,
        lastReadAt,
      };
    })
    .filter((entry): entry is MessageReceiptEntry => !!entry)
    .sort((left, right) => {
      const statusRank = { read: 0, delivered: 1, sent: 2 } as const;
      const rankDiff = statusRank[left.status] - statusRank[right.status];
      if (rankDiff !== 0) {
        return rankDiff;
      }

      const leftTime = getTimestamp(left.lastReadAt ?? left.lastDeliveredAt);
      const rightTime = getTimestamp(right.lastReadAt ?? right.lastDeliveredAt);
      return rightTime - leftTime;
    });
}

function getOwnMessageStatus(message: ChatMessage, chat: Chat | null, currentUserId: string | null) {
  if (!currentUserId || message.senderId !== currentUserId) {
    return null;
  }

  const receiptEntries = getMessageReceiptEntries(message, chat);
  if (receiptEntries.length === 0) {
    return null;
  }

  const readCount = receiptEntries.filter((entry) => entry.status === 'read').length;
  const deliveredCount = receiptEntries.filter((entry) => entry.status !== 'sent').length;

  if (readCount > 0) {
    return {
      text: '✓✓',
      style: styles.messageStatusRead,
      label: chat?.type === 'GROUP' ? `Read by ${readCount}` : 'Read',
    };
  }

  if (deliveredCount > 0) {
    return {
      text: '✓✓',
      style: styles.messageStatusDelivered,
      label: chat?.type === 'GROUP' ? `Delivered to ${deliveredCount}` : 'Delivered',
    };
  }

  return {
    text: '✓',
    style: styles.messageStatusSent,
    label: 'Sent',
  };
}

function SwipeableMessageRow({
  message,
  isMine,
  onReply,
  onLongPress,
  onDoubleTap,
  children,
}: {
  message: ChatMessage;
  isMine: boolean;
  onReply: (message: ChatMessage) => void;
  onLongPress: () => void;
  onDoubleTap: (message: ChatMessage) => void;
  children: React.ReactNode;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const lastTapRef = useRef(0);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dx) > 12 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
        onPanResponderMove: (_, gestureState) => {
          const allowedDx = isMine ? Math.min(0, gestureState.dx) : Math.max(0, gestureState.dx);
          translateX.setValue(Math.max(-88, Math.min(88, allowedDx)));
        },
        onPanResponderRelease: (_, gestureState) => {
          const thresholdReached = isMine ? gestureState.dx < -68 : gestureState.dx > 68;
          if (thresholdReached) {
            onReply(message);
          }

          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            speed: 18,
            bounciness: 6,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            speed: 18,
            bounciness: 6,
          }).start();
        },
      }),
    [isMine, message, onReply, translateX],
  );

  const indicatorOpacity = translateX.interpolate({
    inputRange: isMine ? [-88, -20, 0] : [0, 20, 88],
    outputRange: isMine ? [1, 0.4, 0] : [0, 0.4, 1],
    extrapolate: 'clamp',
  });

  const handlePress = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 260) {
      onDoubleTap(message);
    }
    lastTapRef.current = now;
  };

  return (
    <View style={[styles.swipeContainer, isMine ? styles.swipeContainerMine : styles.swipeContainerOther]}>
      <Animated.View
        style={[
          styles.replySwipeIndicator,
          isMine ? styles.replySwipeIndicatorMine : styles.replySwipeIndicatorOther,
          { opacity: indicatorOpacity },
        ]}
      >
        <Text style={styles.replySwipeIndicatorText}>↩</Text>
      </Animated.View>
      <Animated.View
        style={[styles.swipeContent, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <Pressable style={styles.messagePressable} onLongPress={onLongPress} onPress={handlePress} delayLongPress={240}>
          {children}
        </Pressable>
      </Animated.View>
    </View>
  );
}

function StaggerMessageEntry({
  messageId,
  index,
  children,
}: {
  messageId: string;
  index: number;
  children: React.ReactNode;
}) {
  const entry = useRef(new Animated.Value(0)).current;
  const delay = Math.min(index, 8) * 28;

  useEffect(() => {
    entry.setValue(0);
    Animated.timing(entry, {
      toValue: 1,
      duration: 220,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [delay, entry, messageId]);

  return (
    <Animated.View
      style={{
        opacity: entry,
        transform: [
          {
            translateY: entry.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

export default function ChatScreen({ route, navigation }: Props) {
  const { token, userId } = useAuth();
  const { chatId } = route.params;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [chat, setChat] = useState<Chat | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [oldestCursor, setOldestCursor] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [activeMessage, setActiveMessage] = useState<ChatMessage | null>(null);
  const [isActionSheetOpen, setIsActionSheetOpen] = useState(false);
  const [infoMessage, setInfoMessage] = useState<ChatMessage | null>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [presence, setPresence] = useState<{ isOnline: boolean; lastSeenAt: string | null }>({
    isOnline: false,
    lastSeenAt: null,
  });
  const flatListRef = useRef<FlatList>(null);
  const textInputRef = useRef<TextInput>(null);
  const shouldStickToBottomRef = useRef(true);
  const socketRef = useRef<Socket | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionSheetAnimation = useRef(new Animated.Value(0)).current;
  const appear = useRef(new Animated.Value(0)).current;
  const pendingInfoMessageRef = useRef<ChatMessage | null>(null);
  const previousMessageCountRef = useRef(0);

  const otherMember = chat?.members?.find((member) => member.user?.id !== userId)?.user;

  const formatLastSeen = (value: string | null) => {
    if (!value) {
      return 'offline';
    }

    const date = new Date(value);
    return `last seen ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  const openActionSheet = (message: ChatMessage) => {
    setActiveMessage(message);
    setIsActionSheetOpen(true);
  };

  const openHeaderProfile = () => {
    if (chat?.type === 'GROUP') {
      navigation.navigate('GroupProfile', { chatId });
      return;
    }

    if (otherMember?.id) {
      navigation.navigate('UserProfile', { userId: otherMember.id });
    }
  };

  const closeInfoModal = () => {
    setInfoMessage(null);
  };

  const markChatAsRead = useCallback(async () => {
    try {
      await api.post(
        `/chats/${chatId}/read`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
    } catch {
      // Best-effort only.
    }
  }, [chatId, token]);

  const loadChat = useCallback(async () => {
    try {
      const res = await api.get(`/chats/${chatId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setChat(res.data ?? null);
    } catch (err: any) {
      Alert.alert(
        'Could not load chat',
        err?.response?.data?.message || err?.message || 'Please try again.',
      );
    }
  }, [chatId, token]);

  const loadMessages = useCallback(async () => {
    try {
      const res = await api.get(`/chats/${chatId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { take: MESSAGE_PAGE_SIZE },
      });
      const nextMessages = Array.isArray(res.data) ? (res.data as ChatMessage[]) : [];
      setMessages(nextMessages);
      setOldestCursor(nextMessages[0]?.id ?? null);
      setHasMoreOlder(nextMessages.length >= MESSAGE_PAGE_SIZE);
      await markChatAsRead();
    } catch (err: any) {
      Alert.alert(
        'Could not load messages',
        err?.response?.data?.message || err?.message || 'Please try again.',
      );
    } finally {
      setInitialLoading(false);
    }
  }, [chatId, markChatAsRead, token]);

  const loadOlderMessages = useCallback(async () => {
    if (!oldestCursor || loadingOlder || !hasMoreOlder) {
      return;
    }

    try {
      setLoadingOlder(true);
      const res = await api.get(`/chats/${chatId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          cursor: oldestCursor,
          take: MESSAGE_PAGE_SIZE,
        },
      });

      const olderMessages = Array.isArray(res.data) ? (res.data as ChatMessage[]) : [];

      if (olderMessages.length === 0) {
        setHasMoreOlder(false);
        return;
      }

      setMessages((prev) => {
        const knownIds = new Set(prev.map((message) => message.id));
        const uniqueOlder = olderMessages.filter((message) => !knownIds.has(message.id));
        if (uniqueOlder.length === 0) {
          return prev;
        }

        return [...uniqueOlder, ...prev];
      });

      setOldestCursor(olderMessages[0]?.id ?? oldestCursor);
      if (olderMessages.length < MESSAGE_PAGE_SIZE) {
        setHasMoreOlder(false);
      }
    } catch {
      // Keep silent for scroll-driven pagination.
    } finally {
      setLoadingOlder(false);
    }
  }, [chatId, hasMoreOlder, loadingOlder, oldestCursor, token]);

  useEffect(() => {
    Animated.timing(appear, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [appear]);

  useEffect(() => {
    if (previousMessageCountRef.current !== 0 && previousMessageCountRef.current !== messages.length) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    previousMessageCountRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    loadChat();
    loadMessages();

    const socket = io(API_URL, {
      auth: { token },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('ready', () => {
      socket.emit('join_chat', { chatId });
      if (chat?.type === 'DIRECT' && otherMember?.id) {
        socket.emit('presence:watch', { userId: otherMember.id });
      }
      markChatAsRead();
    });

    socket.on('message:new', (message: ChatMessage) => {
      setMessages((prev) => {
        if (prev.some((existing) => existing.id === message.id)) {
          return prev;
        }
        return [...prev, message];
      });

      if (message.chatId === chatId && message.senderId !== userId) {
        markChatAsRead();
      }
    });

    socket.on('message:update', (message: ChatMessage) => {
      setMessages((prev) => mergeMessage(prev, message));
    });

    socket.on('chat:receipt', (receipt: ChatReceipt) => {
      if (receipt.chatId !== chatId) {
        return;
      }

      setChat((prev) => applyReceiptToChat(prev, receipt));
    });

    socket.on(
      'chat:typing',
      ({ userId: typingUserId, username, isTyping }: { userId: string; username: string; isTyping: boolean }) => {
        if (typingUserId === userId) {
          return;
        }

        setTypingUsers((prev) =>
          isTyping
            ? prev.includes(username)
              ? prev
              : [...prev, username]
            : prev.filter((name) => name !== username),
        );
      },
    );

    socket.on(
      'presence:update',
      ({ userId: presenceUserId, isOnline, lastSeenAt }: { userId: string; isOnline: boolean; lastSeenAt: string | null }) => {
        if (chat?.type !== 'DIRECT' || !otherMember?.id || presenceUserId !== otherMember.id) {
          return;
        }
        setPresence({ isOnline, lastSeenAt });
      },
    );

    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (chat?.type === 'DIRECT' && otherMember?.id) {
        socket.emit('presence:unwatch', { userId: otherMember.id });
      }
      socket.emit('leave_chat', { chatId });
      socket.disconnect();
      socketRef.current = null;
      setTypingUsers([]);
    };
  }, [chat?.type, chatId, loadChat, loadMessages, markChatAsRead, otherMember?.id, token, userId]);

  useEffect(() => {
    if (!activeMessage && !isActionSheetOpen) {
      return;
    }

    if (isActionSheetOpen) {
      Animated.timing(actionSheetAnimation, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(actionSheetAnimation, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setActiveMessage(null);
        if (pendingInfoMessageRef.current) {
          setInfoMessage(pendingInfoMessageRef.current);
          pendingInfoMessageRef.current = null;
        }
      }
    });
  }, [actionSheetAnimation, activeMessage, isActionSheetOpen]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
  }, []);

  useEffect(() => {
    if (!initialLoading) {
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: false });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [initialLoading]);

  const scrollToBottom = (animated = false) => {
    if (messages.length > 0) {
      flatListRef.current?.scrollToEnd({ animated });
    }
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = Math.max(0, contentSize.height - (contentOffset.y + layoutMeasurement.height));
    const isNearBottom = distanceFromBottom <= 120;
    shouldStickToBottomRef.current = isNearBottom;
    setShowScrollToBottom(!isNearBottom);

    if (contentOffset.y <= 80) {
      loadOlderMessages();
    }
  };

  const closeActionSheet = () => {
    setIsActionSheetOpen(false);
  };

  const handleOpenMessageInfo = (message: ChatMessage) => {
    pendingInfoMessageRef.current = message;
    closeActionSheet();
  };

  const handleCopyMessage = async (message: ChatMessage) => {
    if (!message.text) {
      closeActionSheet();
      return;
    }

    await Clipboard.setStringAsync(message.text);
    closeActionSheet();
  };

  const handleSetReaction = async (messageId: string, emoji: string) => {
    try {
      await api.post(
        `/messages/${messageId}/reaction`,
        { emoji },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      closeActionSheet();
    } catch (err: any) {
      Alert.alert(
        'Could not set reaction',
        err?.response?.data?.message || err?.message || 'Please try again.',
      );
    }
  };

  const handleDoubleTapLike = (message: ChatMessage) => {
    handleSetReaction(message.id, '❤️');
  };

  const handleReply = (message: ChatMessage) => {
    setEditingMessage(null);
    setReplyTo(message);
    closeActionSheet();
    setTimeout(() => textInputRef.current?.focus(), 20);
  };

  const handleStartEdit = (message: ChatMessage) => {
    if (!message.text) {
      return;
    }
    setReplyTo(null);
    setEditingMessage(message);
    setText(message.text);
    closeActionSheet();
    setTimeout(() => textInputRef.current?.focus(), 20);
  };

  const handleDeleteMessage = async (messageId: string) => {
    try {
      await api.delete(`/messages/${messageId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (editingMessage?.id === messageId) {
        setEditingMessage(null);
        setText('');
      }
      closeActionSheet();
    } catch (err: any) {
      Alert.alert(
        'Could not delete message',
        err?.response?.data?.message || err?.message || 'Please try again.',
      );
    }
  };

  const clearComposerMode = () => {
    setReplyTo(null);
    setEditingMessage(null);
  };

  const handleTextChange = (value: string) => {
    setText(value);
    const socket = socketRef.current;
    if (!socket?.connected) {
      return;
    }

    socket.emit('typing', { chatId, isTyping: true });
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing', { chatId, isTyping: false });
    }, 2000);
  };

  const sendViaRest = (dto: Record<string, unknown>) => {
    api
      .post('/messages', dto, { headers: { Authorization: `Bearer ${token}` } })
      .then(() => {
        setText('');
        setReplyTo(null);
        loadMessages();
      })
      .catch((err: any) =>
        Alert.alert(
          'Could not send message',
          err?.response?.data?.message || err?.message || 'Please try again.',
        ),
      )
      .finally(() => setSending(false));
  };

  const sendMessage = () => {
    const payload = text.trim();
    if (!payload || sending) {
      return;
    }

    setSending(true);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    socketRef.current?.emit('typing', { chatId, isTyping: false });

    if (editingMessage) {
      api
        .patch(
          `/messages/${editingMessage.id}`,
          { text: payload },
          { headers: { Authorization: `Bearer ${token}` } },
        )
        .then(() => {
          setText('');
          setEditingMessage(null);
        })
        .catch((err: any) =>
          Alert.alert(
            'Could not edit message',
            err?.response?.data?.message || err?.message || 'Please try again.',
          ),
        )
        .finally(() => setSending(false));
      return;
    }

    const dto: Record<string, unknown> = { chatId, text: payload };
    if (replyTo?.id) {
      dto.replyToId = replyTo.id;
    }

    const socket = socketRef.current;
    if (!socket?.connected) {
      sendViaRest(dto);
      return;
    }

    socket.emit('send_message', dto, (response?: ChatMessage | { message?: string }) => {
      if (response && 'id' in response) {
        setText('');
        setReplyTo(null);
        setSending(false);
        return;
      }

      if (response && 'message' in response && response.message) {
        Alert.alert('Could not send message', response.message);
        setSending(false);
        return;
      }

      sendViaRest(dto);
    });
  };

  const headerSubtitle =
    typingUsers.length > 0
      ? `${typingUsers.join(', ')} ${typingUsers.length === 1 ? 'печатает' : 'печатают'}...`
      : chat?.type === 'GROUP'
        ? 'group chat'
      : presence.isOnline
        ? 'online'
        : otherMember?.id
          ? formatLastSeen(presence.lastSeenAt ?? otherMember.lastSeenAt ?? null)
          : 'group chat';

  const activeMessageLikedByMe = activeMessage?.likes?.some((like) => like.user.id === userId) ?? false;
  const infoMessageReceipts = useMemo(() => getMessageReceiptEntries(infoMessage, chat), [chat, infoMessage]);
  const overlayOpacity = actionSheetAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const sheetTranslateY = actionSheetAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [42, 0],
  });
  const reactionsScale = actionSheetAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1],
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <Animated.View
        style={{
          flex: 1,
          opacity: appear,
          transform: [
            {
              translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
            },
          ],
        }}
      >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={55}
      >
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <Pressable style={styles.headerTextWrap} onPress={openHeaderProfile}>
            <Text style={styles.headerTitle}>{route.params.title || 'Chat'}</Text>
            <Text
              style={[styles.headerSubtitle, typingUsers.length > 0 ? styles.headerSubtitleActive : null]}
              numberOfLines={1}
            >
              {headerSubtitle}
            </Text>
          </Pressable>
        </View>

        {initialLoading ? (
          <View style={styles.chatSkeletonWrap}>
            {Array.from({ length: 7 }).map((_, index) => (
              <View
                key={`message-skeleton-${index}`}
                style={[
                  styles.messageSkeleton,
                  index % 2 === 0 ? styles.messageSkeletonOther : styles.messageSkeletonMine,
                ]}
              >
                <View style={styles.messageSkeletonLinePrimary} />
                <View style={styles.messageSkeletonLineSecondary} />
              </View>
            ))}
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 16 }}
            keyboardDismissMode="interactive"
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onLayout={() => {
              if (shouldStickToBottomRef.current) {
                scrollToBottom(false);
              }
            }}
            onContentSizeChange={() => {
              if (shouldStickToBottomRef.current) {
                scrollToBottom(false);
              }
            }}
            renderItem={({ item, index }) => {
              const isMine = item.senderId === userId;
              const reactions = groupReactions(item.likes, userId);
              const canOpenMenu = !item.deletedAt;
              const messageStatus = getOwnMessageStatus(item, chat, userId);

              return (
                <StaggerMessageEntry messageId={item.id} index={index}>
                  <View style={[styles.bubbleWrap, isMine ? styles.mineWrap : styles.otherWrap]}>
                    <SwipeableMessageRow
                      message={item}
                      isMine={isMine}
                      onReply={handleReply}
                      onDoubleTap={handleDoubleTapLike}
                      onLongPress={() => {
                        if (canOpenMenu) {
                          openActionSheet(item);
                        }
                      }}
                    >
                      <View style={[styles.bubble, isMine ? styles.mineBubble : styles.otherBubble]}>
                        {item.replyTo && (
                          <View style={styles.replyContainer}>
                            <Text style={styles.replyAuthor}>
                              Replying to {item.replyTo.sender?.username || 'User'}
                            </Text>
                            <Text style={styles.replyText} numberOfLines={1}>
                              {item.replyTo.deletedAt ? 'Message deleted' : (item.replyTo.text || 'Attachment')}
                            </Text>
                          </View>
                        )}
                        {!isMine && (
                          <Pressable
                            onPress={() => {
                              const senderId = item.sender?.id || item.senderId;
                              if (!senderId) {
                                return;
                              }

                              navigation.navigate('UserProfile', { userId: senderId });
                            }}
                          >
                            <Text style={styles.author}>{item.sender?.username || 'User'}</Text>
                          </Pressable>
                        )}
                        <Text style={item.deletedAt ? styles.deletedMessageText : styles.messageText}>
                          {item.deletedAt ? 'Message deleted' : item.text}
                        </Text>
                        <View style={styles.messageFooter}>
                          <Text style={styles.time}>{formatTime(item.createdAt)}{item.editedAt && !item.deletedAt ? ' · edited' : ''}</Text>
                          {messageStatus && (
                            <Text style={[styles.messageStatus, messageStatus.style]}>
                              {messageStatus.text}
                            </Text>
                          )}
                        </View>
                        {reactions.length > 0 && (
                          <View style={styles.reactionsRow}>
                            {reactions.map((reaction) => (
                              <Pressable
                                key={`${item.id}-${reaction.emoji}`}
                                style={[styles.reactionChip, reaction.reactedByMe ? styles.reactionChipActive : null]}
                                onPress={() => handleSetReaction(item.id, reaction.emoji)}
                              >
                                <Text style={styles.reactionChipText}>{reaction.emoji} {reaction.count}</Text>
                              </Pressable>
                            ))}
                          </View>
                        )}
                      </View>
                    </SwipeableMessageRow>
                  </View>
                </StaggerMessageEntry>
              );
            }}
            ListEmptyComponent={<Text style={styles.emptyText}>No messages yet</Text>}
            ListHeaderComponent={
              loadingOlder ? (
                <Text style={styles.loadingOlderText}>Loading older messages...</Text>
              ) : !hasMoreOlder && messages.length > 0 ? (
                <Text style={styles.loadingOlderDoneText}>Start of chat history</Text>
              ) : null
            }
          />
        )}

        {showScrollToBottom && (
          <Pressable
            style={styles.scrollToBottomButton}
            onPress={() => {
              setShowScrollToBottom(false);
              scrollToBottom(true);
            }}
          >
            <Text style={styles.scrollToBottomText}>↓</Text>
          </Pressable>
        )}

        <View style={styles.composer}>
          {(replyTo || editingMessage) && (
            <View style={styles.replyPreview}>
              <View style={styles.replyPreviewContent}>
                <Text style={styles.replyPreviewLabel}>
                  {editingMessage ? 'Editing message' : `Replying to ${replyTo?.sender?.username || 'User'}`}
                </Text>
                <Text style={styles.replyPreviewText} numberOfLines={1}>
                  {editingMessage ? editingMessage.text : (replyTo?.deletedAt ? 'Message deleted' : (replyTo?.text || 'Attachment'))}
                </Text>
              </View>
              <Pressable onPress={clearComposerMode} style={styles.cancelReply}>
                <Text style={styles.cancelReplyText}>✕</Text>
              </Pressable>
            </View>
          )}
          <View style={styles.inputContainer}>
            <TextInput
              ref={textInputRef}
              style={styles.input}
              placeholder={editingMessage ? 'Edit message' : 'Write a message'}
              placeholderTextColor="#8194b8"
              value={text}
              onChangeText={handleTextChange}
              multiline
            />
            <Pressable style={styles.send} onPress={sendMessage} disabled={sending}>
              <Text style={styles.sendText}>{sending ? '...' : editingMessage ? '✓' : '➤'}</Text>
            </Pressable>
          </View>
        </View>

        <Modal transparent visible={!!activeMessage} onRequestClose={closeActionSheet}>
          <Animated.View style={[styles.actionOverlay, { opacity: overlayOpacity }]}> 
            <Pressable style={styles.actionBackdrop} onPress={closeActionSheet} />
            {activeMessage && (
              <Animated.View
                style={[
                  styles.actionSheetStack,
                  {
                    transform: [{ translateY: sheetTranslateY }],
                  },
                ]}
              >
                <Animated.View style={[styles.reactionRail, { transform: [{ scale: reactionsScale }] }]}> 
                  {QUICK_REACTIONS.map((emoji) => (
                    <Pressable key={emoji} style={styles.reactionButton} onPress={() => handleSetReaction(activeMessage.id, emoji)}>
                      <Text style={styles.reactionEmoji}>{emoji}</Text>
                    </Pressable>
                  ))}
                </Animated.View>

                <View style={styles.actionPreviewCard}>
                  <Text style={styles.actionPreviewAuthor}>
                    {activeMessage.sender?.username || (activeMessage.senderId === userId ? 'You' : 'User')}
                  </Text>
                  <Text style={styles.actionPreviewText}>{activeMessage.deletedAt ? 'Message deleted' : (activeMessage.text || 'Attachment')}</Text>
                </View>

                <View style={styles.actionSheetCard}>
                  {!activeMessage.deletedAt && (
                    <Pressable style={styles.actionRow} onPress={() => handleReply(activeMessage)}>
                      <Text style={styles.actionIcon}>↩</Text>
                      <Text style={styles.actionLabel}>Reply</Text>
                    </Pressable>
                  )}
                  {!!activeMessage.text && !activeMessage.deletedAt && (
                    <Pressable style={styles.actionRow} onPress={() => handleCopyMessage(activeMessage)}>
                      <Text style={styles.actionIcon}>⧉</Text>
                      <Text style={styles.actionLabel}>Copy text</Text>
                    </Pressable>
                  )}
                  {chat?.type === 'GROUP' && activeMessage.senderId === userId && !activeMessage.deletedAt && (
                    <Pressable style={styles.actionRow} onPress={() => handleOpenMessageInfo(activeMessage)}>
                      <Text style={styles.actionIcon}>i</Text>
                      <Text style={styles.actionLabel}>Info</Text>
                    </Pressable>
                  )}
                  {activeMessage.senderId === userId && !activeMessage.deletedAt && (
                    <Pressable style={styles.actionRow} onPress={() => handleStartEdit(activeMessage)}>
                      <Text style={styles.actionIcon}>✎</Text>
                      <Text style={styles.actionLabel}>Edit</Text>
                    </Pressable>
                  )}
                  {activeMessage.senderId === userId && !activeMessage.deletedAt && (
                    <Pressable style={styles.actionRow} onPress={() => handleDeleteMessage(activeMessage.id)}>
                      <Text style={[styles.actionIcon, styles.deleteActionIcon]}>🗑</Text>
                      <Text style={[styles.actionLabel, styles.deleteActionLabel]}>Delete</Text>
                    </Pressable>
                  )}
                  <Pressable style={[styles.actionRow, styles.actionRowLast]} onPress={closeActionSheet}>
                    <Text style={styles.actionIcon}>✕</Text>
                    <Text style={styles.actionLabel}>Close</Text>
                  </Pressable>
                </View>
              </Animated.View>
            )}
          </Animated.View>
        </Modal>

        <Modal transparent visible={!!infoMessage} animationType="fade" onRequestClose={closeInfoModal}>
          <View style={styles.infoOverlay}>
            <Pressable style={styles.infoBackdrop} onPress={closeInfoModal} />
            <View style={styles.infoCard}>
              <View style={styles.infoHeader}>
                <View>
                  <Text style={styles.infoTitle}>Message info</Text>
                  <Text style={styles.infoSubtitle}>Who has seen this message and when.</Text>
                </View>
                <Pressable onPress={closeInfoModal}>
                  <Text style={styles.infoClose}>Close</Text>
                </Pressable>
              </View>

              <ScrollView style={styles.infoList} contentContainerStyle={styles.infoListContent}>
                {infoMessageReceipts.length === 0 ? (
                  <Text style={styles.infoEmpty}>No receipt details yet.</Text>
                ) : (
                  infoMessageReceipts.map((entry) => {
                    const statusText =
                      entry.status === 'read'
                        ? `Read at ${formatTime(entry.lastReadAt ?? undefined)}`
                        : entry.status === 'delivered'
                          ? `Delivered at ${formatTime(entry.lastDeliveredAt ?? undefined)}`
                          : 'Sent, not delivered yet';

                    return (
                      <View key={`${infoMessage?.id}-${entry.userId}`} style={styles.infoRow}>
                        <View style={styles.infoUserBlock}>
                          <Text style={styles.infoUser}>{entry.username}</Text>
                          <Text style={styles.infoMeta}>{statusText}</Text>
                        </View>
                        <Text
                          style={[
                            styles.infoStatus,
                            entry.status === 'read'
                              ? styles.infoStatusRead
                              : entry.status === 'delivered'
                                ? styles.infoStatusDelivered
                                : styles.infoStatusSent,
                          ]}
                        >
                          {entry.status === 'read' ? 'Read' : entry.status === 'delivered' ? 'Delivered' : 'Sent'}
                        </Text>
                      </View>
                    );
                  })
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
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
    paddingVertical: 10,
    backgroundColor: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
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
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: '#7489af',
    fontSize: 12,
    marginTop: 2,
  },
  headerSubtitleActive: {
    color: '#6fb5ff',
  },
  list: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
  },
  swipeContainer: {
    position: 'relative',
    maxWidth: '82%',
  },
  swipeContainerMine: {
    alignSelf: 'flex-end',
  },
  swipeContainerOther: {
    alignSelf: 'flex-start',
  },
  swipeContent: {
    maxWidth: '100%',
  },
  messagePressable: {
    maxWidth: '100%',
  },
  replySwipeIndicator: {
    position: 'absolute',
    top: 12,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#183660',
    alignItems: 'center',
    justifyContent: 'center',
  },
  replySwipeIndicatorMine: {
    left: -40,
  },
  replySwipeIndicatorOther: {
    right: -40,
  },
  replySwipeIndicatorText: {
    color: '#8dc2ff',
    fontSize: 16,
    fontWeight: '700',
  },
  bubbleWrap: {
    marginBottom: 10,
    flexDirection: 'row',
  },
  mineWrap: {
    justifyContent: 'flex-end',
  },
  otherWrap: {
    justifyContent: 'flex-start',
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 84,
    maxWidth: '100%',
  },
  mineBubble: {
    backgroundColor: '#2d6cdf',
    borderBottomRightRadius: 6,
  },
  otherBubble: {
    backgroundColor: '#102443',
    borderBottomLeftRadius: 6,
  },
  author: {
    color: '#9cc1ff',
    fontWeight: '700',
    fontSize: 12,
    marginBottom: 4,
  },
  messageText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 20,
  },
  deletedMessageText: {
    color: '#8ea4c7',
    fontSize: 15,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  time: {
    color: '#d4e1ff',
    opacity: 0.8,
    fontSize: 11,
    marginTop: 6,
  },
  messageStatus: {
    fontSize: 11,
    marginTop: 6,
    marginLeft: 6,
    fontWeight: '700',
  },
  messageStatusSent: {
    color: 'rgba(212, 225, 255, 0.78)',
  },
  messageStatusDelivered: {
    color: '#d4e1ff',
  },
  messageStatusRead: {
    color: '#9fd1ff',
  },
  emptyText: {
    color: '#8ea4c7',
    textAlign: 'center',
    marginTop: 40,
  },
  chatSkeletonWrap: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 16,
    gap: 10,
  },
  messageSkeleton: {
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    width: '78%',
  },
  messageSkeletonMine: {
    alignSelf: 'flex-end',
    backgroundColor: '#2859b8',
  },
  messageSkeletonOther: {
    alignSelf: 'flex-start',
    backgroundColor: '#112746',
  },
  messageSkeletonLinePrimary: {
    height: 11,
    width: '88%',
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    marginBottom: 8,
  },
  messageSkeletonLineSecondary: {
    height: 11,
    width: '62%',
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  loadingOlderText: {
    color: '#8ea4c7',
    textAlign: 'center',
    paddingVertical: 10,
    fontSize: 12,
  },
  loadingOlderDoneText: {
    color: '#6f84ad',
    textAlign: 'center',
    paddingVertical: 10,
    fontSize: 12,
  },
  composer: {
    flexDirection: 'column',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1b2d52',
    backgroundColor: '#07152b',
    alignItems: 'stretch',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    width: '100%',
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 110,
    backgroundColor: '#102443',
    color: '#fff',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginRight: 10,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2d6cdf',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    marginLeft: 2,
  },
  scrollToBottomButton: {
    position: 'absolute',
    right: 16,
    bottom: 80,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2d6cdf',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  scrollToBottomText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  replyContainer: {
    backgroundColor: '#1e293b',
    padding: 8,
    borderRadius: 6,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#60a5fa',
    width: '100%',
  },
  replyAuthor: {
    color: '#60a5fa',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  replyText: {
    color: '#cbd5e1',
    fontSize: 14,
  },
  messageFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 4,
  },
  reactionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  reactionChip: {
    backgroundColor: '#18304f',
    borderWidth: 1,
    borderColor: '#27476e',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
  },
  reactionChipActive: {
    backgroundColor: '#1d467d',
    borderColor: '#6aaeff',
  },
  reactionChipText: {
    color: '#f6f9ff',
    fontSize: 12,
    fontWeight: '700',
  },
  likesContainer: {
    marginLeft: 8,
  },
  likeText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
  },
  replyPreview: {
    backgroundColor: '#1e293b',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  replyPreviewContent: {
    flex: 1,
  },
  replyPreviewLabel: {
    color: '#8fc1ff',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 3,
  },
  replyPreviewText: {
    color: '#cbd5e1',
    fontSize: 14,
    flex: 1,
  },
  cancelReply: {
    marginLeft: 8,
    padding: 4,
  },
  cancelReplyText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '600',
  },
  actionOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 10, 22, 0.56)',
  },
  actionBackdrop: {
    flex: 1,
  },
  actionSheetStack: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  reactionRail: {
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#161f31',
    borderWidth: 1,
    borderColor: '#293650',
    borderRadius: 28,
    paddingHorizontal: 8,
    paddingVertical: 8,
    marginBottom: 12,
  },
  reactionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#24324c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionEmoji: {
    fontSize: 20,
  },
  actionPreviewCard: {
    backgroundColor: '#161d2d',
    borderWidth: 1,
    borderColor: '#28344b',
    borderRadius: 24,
    padding: 16,
    marginBottom: 12,
  },
  actionPreviewAuthor: {
    color: '#84bbff',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  actionPreviewText: {
    color: '#f7f9ff',
    fontSize: 16,
    lineHeight: 22,
  },
  actionSheetCard: {
    backgroundColor: '#121927',
    borderWidth: 1,
    borderColor: '#26324a',
    borderRadius: 28,
    overflow: 'hidden',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#202b40',
  },
  actionRowLast: {
    borderBottomWidth: 0,
  },
  actionIcon: {
    color: '#92c0ff',
    fontSize: 19,
    width: 28,
    textAlign: 'center',
    marginRight: 12,
  },
  actionLabel: {
    color: '#f4f7ff',
    fontSize: 17,
    fontWeight: '600',
  },
  deleteActionIcon: {
    color: '#ff7b7b',
  },
  deleteActionLabel: {
    color: '#ff8f8f',
  },
  infoOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 10, 22, 0.6)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  infoBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  infoCard: {
    backgroundColor: '#101a2b',
    borderWidth: 1,
    borderColor: '#25334e',
    borderRadius: 24,
    padding: 18,
    maxHeight: '70%',
  },
  infoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  infoTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
  },
  infoSubtitle: {
    color: '#8ea4c7',
    marginTop: 4,
  },
  infoClose: {
    color: '#9ec2ff',
    fontWeight: '700',
  },
  infoList: {
    flexGrow: 0,
  },
  infoListContent: {
    gap: 10,
  },
  infoEmpty: {
    color: '#8ea4c7',
    textAlign: 'center',
    paddingVertical: 24,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#151f32',
    borderWidth: 1,
    borderColor: '#24324b',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  infoUserBlock: {
    flex: 1,
  },
  infoUser: {
    color: '#f7f9ff',
    fontSize: 15,
    fontWeight: '700',
  },
  infoMeta: {
    color: '#95a8ca',
    fontSize: 13,
    marginTop: 4,
  },
  infoStatus: {
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  infoStatusSent: {
    color: '#d4e1ff',
    backgroundColor: '#2a3a58',
  },
  infoStatusDelivered: {
    color: '#dff0ff',
    backgroundColor: '#244c7d',
  },
  infoStatusRead: {
    color: '#07203d',
    backgroundColor: '#9fd1ff',
  },
});
