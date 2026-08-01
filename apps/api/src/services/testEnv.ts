import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017/unused-test-config';
process.env.JWT_SECRET ??= 'integration-test-secret-at-least-32-characters';
// Logs are structured JSON from Phase 12 onwards. A passing test run should not
// bury its assertions under a request log for every call.
process.env.LOG_LEVEL ??= 'error';
// Rate limiting is exercised deliberately in `hardeningIntegration.test.ts`
// against its own store and budget. The ambient limits are raised so the other
// suites, which make hundreds of calls within a single window, keep testing the
// behaviour they were written for rather than the limiter.
process.env.RATE_LIMIT_GLOBAL_MAX ??= '1000000';
process.env.RATE_LIMIT_AUTH_MAX ??= '1000000';
process.env.RATE_LIMIT_WRITE_MAX ??= '1000000';
process.env.RATE_LIMIT_REPORT_MAX ??= '1000000';
process.env.MONGOMS_DOWNLOAD_DIR ??= path.resolve(
  __dirname,
  '../../../../node_modules/.cache/mongodb-memory-server',
);
