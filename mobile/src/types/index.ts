export type SessionUser = {
  id: string;
  email: string;
  username: string;
};

export type ChatUser = {
  id: string;
  username: string;
  email?: string;
};

export type ChatMember = {
  id: string;
  role?: string;
  userId?: string;
  user?: ChatUser;
};

export type ChatMessage = {
  id: string;
  text: string;
  senderId: string;
  createdAt?: string;
  sender?: {
    id: string;
    username?: string;
  };
};

export type Chat = {
  id: string;
  type?: string;
  title?: string | null;
  createdAt?: string;
  members?: ChatMember[];
  messages?: ChatMessage[];
};

export type RootStackParamList = {
  Login: undefined;
  Chats: undefined;
  Chat: {
    chatId: string;
    title?: string;
  };
};

export type SearchUser = {
  id: string;
  username: string;
  email?: string;
  createdAt?: string;
};