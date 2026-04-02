import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../api/client';
import { formatTime } from '../utils/chat';
import { useAuth } from '../contexts/AuthContext';
import type { ChatMessage, RootStackParamList } from '../types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

export default function ChatScreen({ route, navigation }: Props) {
  const { token, userId } = useAuth();
  const { chatId } = route.params;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const shouldStickToBottomRef = useRef(true);

  const loadMessages = useCallback(async () => {
    try {
      const res = await api.get(`/chats/${chatId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMessages(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      Alert.alert(
        'Could not load messages',
        err?.response?.data?.message || err?.message || 'Please try again.',
      );
    }
  }, [chatId, token]);

  useEffect(() => {
    loadMessages();
    const interval = setInterval(loadMessages, 4000);
    return () => clearInterval(interval);
  }, [loadMessages]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
  }, []);

  const scrollToBottom = (animated = false) => {
    if (messages.length > 0) {
      flatListRef.current?.scrollToEnd({ animated });
    }
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = Math.max(
      0,
      contentSize.height - (contentOffset.y + layoutMeasurement.height),
    );
    const isNearBottom = distanceFromBottom <= 120;
    shouldStickToBottomRef.current = isNearBottom;
    setShowScrollToBottom(!isNearBottom);
  };

  const handleLike = async (messageId: string) => {
    try {
      await api.post(
        `/messages/${messageId}/like`,
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      await loadMessages();
    } catch (err: any) {
      Alert.alert(
        'Could not toggle like',
        err?.response?.data?.message || err?.message || 'Please try again.',
      );
    }
  };

  const handleReply = (message: ChatMessage) => {
    setReplyTo(message);
  };

  const cancelReply = () => {
    setReplyTo(null);
  };

  const sendMessage = async () => {
    const payload = text.trim();
    if (!payload) return;

    try {
      setSending(true);
      await api.post(
        '/messages',
        {
          chatId,
          text: payload,
          replyToId: replyTo?.id,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setText('');
      setReplyTo(null);
      await loadMessages();
    } catch (err: any) {
      Alert.alert(
        'Could not send message',
        err?.response?.data?.message || err?.message || 'Please try again.',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={7}
      >
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <Text style={styles.headerTitle}>{route.params.title || 'Chat'}</Text>
        </View>
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
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
          renderItem={({ item }) => {
            const isMine = item.senderId === userId;
            const isLikedByMe = item.likes?.some(like => like.user.id === userId);
            const likeCount = item._count?.likes || 0;

            return (
              <Pressable
                style={[styles.bubbleWrap, isMine ? styles.mineWrap : styles.otherWrap]}
                onLongPress={() => {
                  Alert.alert(
                    'Message options',
                    'Choose an action',
                    [
                      { text: 'Reply', onPress: () => handleReply(item) },
                      { text: 'Like', onPress: () => handleLike(item.id) },
                      { text: 'Cancel', style: 'cancel' },
                    ],
                  );
                }}
                onPress={() => {
                  // Double tap for like
                  if (isLikedByMe) {
                    handleLike(item.id);
                  }
                }}
                delayLongPress={500}
              >
                <View style={[styles.bubble, isMine ? styles.mineBubble : styles.otherBubble]}>
                  {item.replyTo && (
                    <View style={styles.replyContainer}>
                      <Text style={styles.replyAuthor}>
                        Replying to {item.replyTo.sender?.username || 'User'}
                      </Text>
                      <Text style={styles.replyText} numberOfLines={1}>
                        {item.replyTo.text}
                      </Text>
                    </View>
                  )}
                  {!isMine && (
                    <Text style={styles.author}>{item.sender?.username || 'User'}</Text>
                  )}
                  <Text style={styles.messageText}>{item.text}</Text>
                  <View style={styles.messageFooter}>
                    <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
                    {likeCount > 0 && (
                      <View style={styles.likesContainer}>
                        <Text style={styles.likeText}>❤️ {likeCount}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={<Text style={styles.emptyText}>No messages yet</Text>}
        />

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
          {replyTo && (
            <View style={styles.replyPreview}>
              <Text style={styles.replyPreviewText}>
                Replying to {replyTo.sender?.username || 'User'}: {replyTo.text}
              </Text>
              <Pressable onPress={cancelReply} style={styles.cancelReply}>
                <Text style={styles.cancelReplyText}>✕</Text>
              </Pressable>
            </View>
          )}
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="Write a message"
              placeholderTextColor="#8194b8"
              value={text}
              onChangeText={setText}
              multiline
            />
            <Pressable style={styles.send} onPress={sendMessage} disabled={sending}>
              <Text style={styles.sendText}>{sending ? '...' : '➤'}</Text>
            </Pressable>
          </View>
        </View>
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
    backgroundColor: '#07152b',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
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
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  list: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
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
    maxWidth: '80%',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
  time: {
    color: '#d4e1ff',
    opacity: 0.8,
    fontSize: 11,
    marginTop: 6,
    alignSelf: 'flex-end',
  },
  emptyText: {
    color: '#8ea4c7',
    textAlign: 'center',
    marginTop: 40,
  },
  composer: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1b2d52',
    backgroundColor: '#07152b',
    alignItems: 'flex-end',
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
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
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
    flexDirection: 'row',
    alignItems: 'center',
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
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
});
