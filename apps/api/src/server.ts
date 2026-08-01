import { createServer } from 'http';
import { connectDB, disconnectDB } from './db';
import { env } from './env';
import { app, corsOrigins } from './app';
import { logger } from './services/logger';
import { initialiseRealtime, closeRealtime } from './services/realtime';
import {
  notificationQueue,
  startNotificationSweeper,
  stopNotificationSweeper,
} from './services/notificationService';
import {
  startNotificationSchedules,
  stopNotificationSchedules,
} from './services/notificationSchedules';

const port = env.PORT;

/** How long in-flight work is given before the process stops regardless. */
const SHUTDOWN_GRACE_MS = 15_000;

const startServer = async () => {
  await connectDB();

  // Express and Socket.IO share one HTTP server so both use the same port and TLS.
  const httpServer = createServer(app);
  initialiseRealtime(httpServer, corsOrigins);

  // A request that arrives just as the socket is being reaped is answered
  // rather than reset; the keep-alive window is the shorter of the two so the
  // server never closes a connection a load balancer still believes is idle.
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 70_000;
  // A slow-header attack ties up a connection indefinitely otherwise.
  httpServer.requestTimeout = 120_000;

  const queue = notificationQueue();
  startNotificationSweeper();
  await startNotificationSchedules();

  httpServer.listen(port, () => {
    logger.info('API listening', {
      port,
      environment: env.NODE_ENV,
      version: env.APP_VERSION,
      realtimePath: '/realtime',
      notificationQueueDriver: queue.driver,
    });
  });

  /**
   * Ordered shutdown.
   *
   * The listener closes first so no new request is accepted, then background
   * work is stopped, then the queue is drained so a notification already
   * accepted is not lost, and the database connection closes last because
   * everything above it may still need to write. A hard timer guarantees the
   * process exits even if one of those hangs, because an orchestrator that
   * has to send SIGKILL is an orchestrator that will interrupt a transaction.
   */
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down', { signal });

    const hardStop = setTimeout(() => {
      logger.error('Shutdown exceeded its grace period; exiting');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    hardStop.unref();

    try {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      stopNotificationSweeper();
      await stopNotificationSchedules();
      await queue.close();
      await closeRealtime();
      await disconnectDB();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Shutdown failed', { reason: (error as Error).message });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // A rejection nobody handled means the process is in a state it was never
  // designed for. It is logged loudly and the instance is retired; a container
  // that restarts is far safer than one continuing to serve from an unknown
  // state, and readiness will keep traffic away until it is back.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) });
    void shutdown('unhandledRejection');
  });
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { message: error.message, stack: error.stack });
    void shutdown('uncaughtException');
  });
};

startServer();
