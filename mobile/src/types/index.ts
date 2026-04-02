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
  text: string | null;
  senderId: string;
  chatId: string;
  type?: string;
  attachmentId?: string | null;
  replyToId?: string | null;
  createdAt?: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  sender?: {
    id: string;
    username?: string;
  };
  attachment?: {
    id: string;
    originalName: string;
    mimeType: string;
    size: number;
    url: string;
  };
  replyTo?: {
    id: string;
    text: string | null;
    sender?: {
      id: string;
      username?: string;
    };
  };
  likes?: {
    id: string;
    user: {
      id: string;
      username: string;
    };
  }[];
  _count?: {
    likes: number;
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