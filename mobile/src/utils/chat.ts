import type { Chat, ChatUser } from '../types';

export function getOtherUser(chat: Chat, currentUserId: string): ChatUser | undefined {
  return chat.members?.find((member) => member.user?.id !== currentUserId)?.user;
}

export function getChatTitle(chat: Chat, currentUserId: string): string {
  if (chat.title?.trim()) return chat.title.trim();
  const other = getOtherUser(chat, currentUserId);
  return other?.username || 'Unknown user';
}

export function getLastMessage(chat: Chat): string {
  const last = chat.messages?.[chat.messages.length - 1]?.text?.trim();
  return last || 'No messages yet';
}

export function getInitials(label: string): string {
  return label.slice(0, 1).toUpperCase() || '?';
}

export function formatTime(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
