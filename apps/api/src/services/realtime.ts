import type { Server as HttpServer } from 'http';
import { Types } from 'mongoose';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { RealtimeEvent, UserRole, UserStatus } from '@medsupply/shared-types';
import { Session } from '../models/Session';
import { Shop } from '../models/Shop';
import { User } from '../models/User';
import { redisUrl } from './jobQueue';
import { logger } from './logger';
import { verifyAccessToken } from './tokenService';

interface SocketIdentity {
  userId: string;
  role: UserRole;
  shopIds: string[];
}

let io: SocketIOServer | null = null;
let driver: 'redis' | 'single-instance' = 'single-instance';

const userRoom = (userId: string) => `user:${userId}`;
const roleRoom = (role: UserRole) => `role:${role}`;
const shopRoom = (shopId: string) => `shop:${shopId}`;

/**
 * Handshake authentication. The access token is passed through `auth.token`
 * rather than a query string so it does not land in proxy or server logs.
 */
async function authenticate(socket: Socket): Promise<SocketIdentity> {
  const raw = socket.handshake.auth?.token;
  const token = typeof raw === 'string' ? raw.replace(/^Bearer\s+/i, '').trim() : '';
  if (!token) throw new Error('No token provided');

  const decoded = verifyAccessToken(token);
  if (!decoded.userId) throw new Error('Invalid token payload');

  const user = await User.findById(decoded.userId).select('role status');
  if (!user) throw new Error('User not found');
  if (user.status !== UserStatus.ACTIVE) throw new Error('Account is not active');

  // A socket outlives the request that opened it, so a revoked session has to
  // be refused here as well; otherwise signing out a device leaves it receiving
  // live updates for the rest of the connection.
  if (decoded.sid) {
    const session = await Session.findById(decoded.sid).select('revokedAt expiresAt').lean();
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new Error('This session has been signed out');
    }
  }

  const role = user.role as UserRole;
  let shopIds: string[] = [];
  if (role === UserRole.SHOP_OWNER) {
    const shops = await Shop.find({ ownerIds: user._id }).select('_id').lean();
    shopIds = shops.map((shop) => String(shop._id));
  }

  return { userId: String(user._id), role, shopIds };
}

export function initialiseRealtime(httpServer: HttpServer, corsOrigins: string[]): SocketIOServer {
  const server = new SocketIOServer(httpServer, {
    path: '/realtime',
    cors: { origin: corsOrigins, credentials: true },
    // Long polling stays enabled so a client behind a websocket-hostile proxy
    // still receives updates instead of silently falling back to nothing.
    transports: ['websocket', 'polling'],
  });

  const url = redisUrl();
  if (url) {
    try {
      // Lazily required so a single-instance deployment never loads Redis.
      const { createAdapter } =
        require('@socket.io/redis-adapter') as typeof import('@socket.io/redis-adapter');
      const Redis = require('ioredis') as typeof import('ioredis');
      const pubClient = new Redis.default(url);
      const subClient = pubClient.duplicate();
      server.adapter(createAdapter(pubClient, subClient));
      driver = 'redis';
    } catch (error) {
      logger.warn('Redis adapter unavailable; running single-instance', { error });
    }
  }

  server.use((socket, next) => {
    authenticate(socket)
      .then((identity) => {
        socket.data.identity = identity;
        next();
      })
      .catch((error: Error) => next(new Error(error.message)));
  });

  server.on('connection', (socket) => {
    const identity = socket.data.identity as SocketIdentity;
    void socket.join(userRoom(identity.userId));
    void socket.join(roleRoom(identity.role));
    for (const shopId of identity.shopIds) void socket.join(shopRoom(shopId));
    socket.emit(RealtimeEvent.CONNECTED, {
      userId: identity.userId,
      role: identity.role,
      shopIds: identity.shopIds,
    });
  });

  io = server;
  return server;
}

export function realtimeServer(): SocketIOServer | null {
  return io;
}

/**
 * Which fan-out the process actually got. Reported by the runtime status
 * endpoint, because "single-instance" is a correct configuration but a
 * surprising one to discover on a horizontally scaled deployment.
 */
export function realtimeDriver(): 'redis' | 'single-instance' | 'off' {
  if (!io) return 'off';
  return driver;
}

export async function closeRealtime() {
  await io?.close();
  io = null;
  driver = 'single-instance';
}

type Identifier = string | Types.ObjectId;

const asRoom = (value: Identifier, build: (id: string) => string) => build(String(value));

/** Every emit is a no-op when realtime is not initialised, e.g. under tests or scripts. */
export function emitToUsers(userIds: Identifier[], event: RealtimeEvent, payload: unknown) {
  if (!io || !userIds.length) return;
  const rooms = [...new Set(userIds.map((id) => asRoom(id, userRoom)))];
  io.to(rooms).emit(event, payload);
}

export function emitToRoles(roles: UserRole[], event: RealtimeEvent, payload: unknown) {
  if (!io || !roles.length) return;
  io.to(roles.map(roleRoom)).emit(event, payload);
}

export function emitToShop(shopId: Identifier, event: RealtimeEvent, payload: unknown) {
  if (!io) return;
  io.to(asRoom(shopId, shopRoom)).emit(event, payload);
}

export interface EntityUpdateInput {
  event: RealtimeEvent;
  entityType: string;
  entityId: Identifier;
  reference?: string;
  status?: string;
  orderId?: Identifier;
  shopId?: Identifier;
  /** Internal roles that should refresh their queues. */
  roles?: UserRole[];
  /** Specific users, e.g. the assigned delivery person. */
  userIds?: Identifier[];
  /** When true, owners of `shopId` also receive the update. */
  notifyShop?: boolean;
}

/**
 * One shape for every "this record changed, refetch it" broadcast so clients
 * can invalidate a query cache without parsing per-domain payloads.
 */
export function emitEntityUpdate(input: EntityUpdateInput) {
  if (!io) return;
  const payload = {
    entityType: input.entityType,
    entityId: String(input.entityId),
    reference: input.reference,
    status: input.status,
    orderId: input.orderId ? String(input.orderId) : undefined,
    shopId: input.shopId ? String(input.shopId) : undefined,
    at: new Date().toISOString(),
  };
  if (input.roles?.length) emitToRoles(input.roles, input.event, payload);
  if (input.userIds?.length) emitToUsers(input.userIds, input.event, payload);
  if (input.notifyShop && input.shopId) emitToShop(input.shopId, input.event, payload);
}
