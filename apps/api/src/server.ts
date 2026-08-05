// First, and before anything that reads configuration. `./env` validates the
// environment the moment it is imported and exits when it is incomplete, so a
// `.env` loaded any later would arrive after the process had already given up.
// In a container there is no such file and dotenv is a silent no-op; this is
// what makes the local workflow in docs/SETUP.md work without one.
import 'dotenv/config';
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
import { getSettings } from './services/settingsService';

const port = env.PORT;

/** How long in-flight work is given before the process stops regardless. */
const SHUTDOWN_GRACE_MS = 15_000;

const startServer = async () => {
  await connectDB();

  /*
   * Read the settings once before the port opens, so the shared formatters are
   * configured before the first request rather than by whichever request
   * happens to read settings first. It also means a currency or time zone this
   * build cannot resolve stops the process here, where somebody is watching,
   * instead of throwing inside an invoice render.
   */
  await getSettings();

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

  /*
   * A port that is already taken must stop this process, loudly.
   *
   * There was no `'error'` listener here, so `EADDRINUSE` surfaced as an
   * uncaught exception — a stack trace that scrolls past in a `--parallel`
   * turbo run, while the process that *did* hold the port carried on serving.
   * That is how a build from thirty-four hours earlier answered every request
   * for a day and a half: six route groups added in the meantime returned 404,
   * and the only visible symptom was screens reporting that records had been
   * removed. The remedy is a sentence naming the port, not a stack.
   */
  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(
        `Port ${port} is already in use, so this server did not start. ` +
          'Another instance is answering on it — very likely an older build. ' +
          'Stop it before starting this one.',
      );
    } else {
      logger.error('The server could not open its port', { port, reason: error.message });
    }
    process.exit(1);
  });

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
