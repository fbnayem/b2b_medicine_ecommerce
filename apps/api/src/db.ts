import mongoose from 'mongoose';
import { env, isProduction } from './env';
import { logger } from './services/logger';

/**
 * Database connection.
 *
 * The defaults matter more than they look. `maxPoolSize` bounds how many
 * operations this instance can have in flight, which is what stops a burst of
 * report requests from queueing behind each other on the driver instead of
 * being rejected by the rate limiter. `bufferCommands: false` makes a query
 * issued while disconnected fail immediately rather than sit in a buffer until
 * a timeout no caller is waiting for any more.
 */
export const connectDB = async () => {
  // Mongoose's global `sanitizeFilter` is deliberately not enabled: it wraps
  // every operator in `$eq` unless the call site opts out with `trusted()`,
  // which would break the hundreds of legitimate `$in`, `$gte` and `$lte`
  // filters this codebase depends on. Untrusted input is constrained where it
  // enters instead — see `middlewares/requestContext.sanitiseRequest`.
  try {
    const connection = await mongoose.connect(env.MONGODB_URI, {
      // In production indexes are built by the release step, not by whichever
      // request happens to arrive first. Automatic building is convenient in
      // development and, on a collection with real volume, is the difference
      // between a planned migration and a surprise one during a deployment.
      // See `scripts/checkIndexes.ts`.
      autoIndex: !isProduction,
      maxPoolSize: env.DB_MAX_POOL_SIZE,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 60_000,
      bufferCommands: false,
      // Every write is acknowledged by a majority before it is reported as
      // done, so a failover cannot lose an invoice or a payment.
      writeConcern: { w: 'majority' },
    });
    logger.info('Connected to MongoDB', { host: connection.connection.host });
  } catch (error) {
    logger.error('Could not connect to MongoDB', { reason: (error as Error).message });
    process.exit(1);
  }

  mongoose.connection.on('disconnected', () => logger.warn('MongoDB connection lost'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB connection restored'));
};

export const disconnectDB = async () => {
  await mongoose.connection.close(false);
};
