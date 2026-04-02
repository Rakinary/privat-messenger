import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { BadRequestException, Injectable, Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { ChatsService } from '../chats/chats.service';
import { CreateMessageDto } from '../messages/dto/create-message.dto';
import { MessagesService } from '../messages/messages.service';
import { UsersService } from '../users/users.service';

interface AuthedSocket extends Socket {
  data: {
    user?: {
      sub: string;
      email: string;
      username: string;
    };
  };
}

type ChatReceiptPayload = {
  chatId: string;
  userId: string;
  lastDeliveredAt: Date | string | null;
  lastReadAt: Date | string | null;
};

@Injectable()
@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly activeConnections = new Map<string, number>();
  private readonly lastSeenAt = new Map<string, Date>();

  constructor(
    private readonly authService: AuthService,
    private readonly chatsService: ChatsService,
    private readonly messagesService: MessagesService,
    private readonly usersService: UsersService,
  ) {}

  async handleConnection(client: AuthedSocket) {
    try {
      const token =
        client.handshake.auth?.token ||
        this.extractBearer(client.handshake.headers.authorization);

      if (!token) {
        client.emit('error', { message: 'Missing token' });
        client.disconnect();
        return;
      }

      const user = await this.authService.verifyToken(token);
      client.data.user = user;
      await client.join(`user:${user.sub}`);
      this.trackConnectedUser(user.sub);
      await this.usersService.touchLastSeen(user.sub, new Date());
      const deliveredReceipts = await this.chatsService.syncDeliveredChatsForUser(user.sub);
      for (const receipt of deliveredReceipts) {
        await this.broadcastChatReceipt(receipt);
      }
      await this.broadcastPresence(user.sub);
      client.emit('ready', { user });
      this.logger.log(`Socket connected: ${user.username}`);
    } catch (error) {
      client.emit('error', { message: 'Unauthorized socket connection' });
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthedSocket) {
    const user = client.data.user;
    if (user) {
      const disconnectedAt = this.trackDisconnectedUser(user.sub);
      if (disconnectedAt) {
        await this.usersService.touchLastSeen(user.sub, disconnectedAt);
      }
      await this.broadcastPresence(user.sub);
      this.logger.log(`Socket disconnected: ${user.username}`);
    }
  }

  @SubscribeMessage('presence:watch')
  async watchPresence(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { userId: string },
  ) {
    this.requireUser(client);
    if (!body?.userId) {
      throw new BadRequestException('userId is required');
    }

    await client.join(`presence:${body.userId}`);
    client.emit('presence:update', await this.getPresencePayload(body.userId));
    return { ok: true };
  }

  @SubscribeMessage('presence:unwatch')
  async unwatchPresence(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { userId: string },
  ) {
    if (!body?.userId) {
      throw new BadRequestException('userId is required');
    }

    await client.leave(`presence:${body.userId}`);
    return { ok: true };
  }

  @SubscribeMessage('join_chat')
  async joinChat(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { chatId: string },
  ) {
    const user = this.requireUser(client);
    if (!body?.chatId) {
      throw new BadRequestException('chatId is required');
    }

    await this.chatsService.ensureUserIsChatMember(body.chatId, user.sub);
    const receipt = await this.chatsService.markChatAsRead(body.chatId, user.sub);
    await client.join(`chat:${body.chatId}`);
    await this.broadcastChatReceipt(receipt);
    return { ok: true };
  }

  @SubscribeMessage('leave_chat')
  async leaveChat(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { chatId: string },
  ) {
    if (!body?.chatId) {
      throw new BadRequestException('chatId is required');
    }

    await client.leave(`chat:${body.chatId}`);
    return { ok: true };
  }

  @SubscribeMessage('typing')
  async typing(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { chatId: string; isTyping: boolean },
  ) {
    const user = this.requireUser(client);

    if (!body?.chatId) {
      throw new BadRequestException('chatId is required');
    }

    await this.chatsService.ensureUserIsChatMember(body.chatId, user.sub);

    client.to(`chat:${body.chatId}`).emit('chat:typing', {
      chatId: body.chatId,
      userId: user.sub,
      username: user.username,
      isTyping: !!body.isTyping,
    });

    return { ok: true };
  }

  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @SubscribeMessage('send_message')
  async sendMessage(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: CreateMessageDto,
  ) {
    const user = this.requireUser(client);
    const message = await this.messagesService.create(user.sub, body);
    await this.broadcastNewMessage(message.chatId, message);
    return message;
  }

  async broadcastNewMessage(chatId: string, message: any) {
    const memberIds = await this.chatsService.getChatMemberIds(chatId);

    for (const userId of memberIds) {
      this.server.to(`user:${userId}`).emit('message:new', message);

      if (userId !== message.senderId && (this.activeConnections.get(userId) ?? 0) > 0) {
        const receipt = await this.chatsService.markChatAsDelivered(
          chatId,
          userId,
          message.createdAt ? new Date(message.createdAt) : undefined,
        );

        if (receipt.changed) {
          await this.broadcastChatReceipt(receipt);
        }
      }
    }

    this.server.to(`chat:${chatId}`).emit('message:new', message);

    await this.sendPushNotifications(chatId, message);
  }

  async broadcastMessageUpdated(message: any) {
    if (!message?.chatId) {
      return;
    }

    const memberIds = await this.chatsService.getChatMemberIds(message.chatId);

    for (const memberId of memberIds) {
      this.server.to(`user:${memberId}`).emit('message:update', message);
    }

    this.server.to(`chat:${message.chatId}`).emit('message:update', message);
  }

  async broadcastMessageLike(messageId: string) {
    const message = await this.messagesService.findOne(messageId);
    if (!message) return;
    const memberIds = await this.chatsService.getChatMemberIds(message.chatId);

    for (const memberId of memberIds) {
      this.server.to(`user:${memberId}`).emit('message:update', message);
    }

    this.server.to(`chat:${message.chatId}`).emit('message:update', message);
  }

  async broadcastChatReceipt(payload: ChatReceiptPayload) {
    if (!payload?.chatId || !payload?.userId) {
      return;
    }

    const memberIds = await this.chatsService.getChatMemberIds(payload.chatId);
    const normalizedPayload = {
      chatId: payload.chatId,
      userId: payload.userId,
      lastDeliveredAt: payload.lastDeliveredAt ? new Date(payload.lastDeliveredAt).toISOString() : null,
      lastReadAt: payload.lastReadAt ? new Date(payload.lastReadAt).toISOString() : null,
    };

    for (const memberId of memberIds) {
      this.server.to(`user:${memberId}`).emit('chat:receipt', normalizedPayload);
    }

    this.server.to(`chat:${payload.chatId}`).emit('chat:receipt', normalizedPayload);
  }

  private async sendPushNotifications(chatId: string, message: any) {
    if (!message || !message.senderId || !message.text) {
      return;
    }

    const activeViewerIds = await this.getActiveUserIdsInRoom(`chat:${chatId}`);
    const recipientIds = (await this.chatsService.getChatMemberIds(chatId)).filter(
      (id) => id !== message.senderId && !activeViewerIds.has(id),
    );

    if (recipientIds.length === 0) {
      return;
    }

    const usersWithTokens = await this.usersService.getUserPushTokens(recipientIds);
    const pushTokens = usersWithTokens
      .map((u) => u.expoPushToken)
      .filter((token): token is string => !!token);

    if (pushTokens.length === 0) {
      return;
    }

    const notifications = pushTokens.map((token) => ({
      to: token,
      sound: 'default',
      title: `Новое сообщение от ${message.sender?.username ?? 'пользователя'}`,
      body: message.text.length > 100 ? `${message.text.slice(0, 97)}...` : message.text,
      data: {
        chatId,
        messageId: message.id,
      },
    }));

    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notifications),
      });

      if (!response.ok) {
        const text = await response.text();
        this.logger.warn(`Expo push failed, status: ${response.status}, body: ${text}`);
      }
    } catch (err) {
      this.logger.warn(`Expo push exception: ${err}`);
    }
  }

  private extractBearer(header?: string) {
    if (!header) return undefined;
    const [type, token] = header.split(' ');
    if (type?.toLowerCase() !== 'bearer') return undefined;
    return token;
  }

  private async getActiveUserIdsInRoom(roomName: string) {
    const sockets = await this.server.in(roomName).fetchSockets();
    const userIds = new Set<string>();

    for (const socket of sockets) {
      const userId = socket.data?.user?.sub;
      if (userId) {
        userIds.add(userId);
      }
    }

    return userIds;
  }

  private trackConnectedUser(userId: string) {
    this.activeConnections.set(userId, (this.activeConnections.get(userId) ?? 0) + 1);
  }

  private trackDisconnectedUser(userId: string) {
    const current = this.activeConnections.get(userId) ?? 0;
    if (current <= 1) {
      this.activeConnections.delete(userId);
      const now = new Date();
      this.lastSeenAt.set(userId, now);
      return now;
    }

    this.activeConnections.set(userId, current - 1);
    return null;
  }

  private async getPresencePayload(userId: string) {
    const persistedPresence = await this.usersService.getPresenceSnapshot(userId);
    const lastSeenAt = this.lastSeenAt.get(userId)?.toISOString() ?? persistedPresence?.lastSeenAt?.toISOString() ?? null;
    return {
      userId,
      isOnline: (this.activeConnections.get(userId) ?? 0) > 0,
      lastSeenAt,
    };
  }

  private async broadcastPresence(userId: string) {
    const payload = await this.getPresencePayload(userId);
    this.server.to(`presence:${userId}`).emit('presence:update', payload);
    this.server.to(`user:${userId}`).emit('presence:update', payload);
  }

  private requireUser(client: AuthedSocket) {
    const user = client.data.user;
    if (!user) {
      throw new BadRequestException('Socket user is missing');
    }
    return user;
  }
}
