import { z } from 'zod';

/**
 * Infrastructure configuration only.
 *
 * Business configuration moved into persisted System Settings in Phase 10, so
 * everything that an administrator can reasonably change at runtime lives
 * there. What remains here is what must be true before the process can serve a
 * request at all: where the database is, how tokens are signed, who may call
 * the API and how hard a caller may push it.
 */

const positiveInt = (fallback: number, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(1).max(max).default(fallback);

/**
 * A signing secret has to survive an offline guessing attack against any token
 * an attacker already holds, so it is length-checked rather than merely
 * present. The development default in `.env.example` is deliberately long
 * enough to pass, and production additionally refuses to run with it.
 */
const signingSecret = z
  .string()
  .min(32, 'must be at least 32 characters so it cannot be brute forced offline');

const envSchema = z
  .object({
    PORT: positiveInt(5000, 65_535),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    MONGODB_URI: z.string().min(1),
    JWT_SECRET: signingSecret,

    /**
     * Optional dedicated refresh secret. When it is absent the refresh secret
     * is derived from `JWT_SECRET`, which is how every deployment before this
     * phase worked; setting it separately means a leaked access-token secret
     * cannot be used to mint refresh tokens.
     */
    REFRESH_TOKEN_SECRET: signingSecret.optional(),
    ACCESS_TOKEN_TTL_MINUTES: positiveInt(15, 1440),
    REFRESH_TOKEN_TTL_DAYS: positiveInt(7, 365),

    /**
     * Number of proxies in front of the API. Rate limiting and audit records
     * are only as trustworthy as `req.ip`, and `req.ip` is only trustworthy
     * when Express is told exactly how many hops to skip. Zero means the API
     * is addressed directly and `X-Forwarded-For` is ignored entirely.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

    /** Request body ceilings. Uploads are base64 JSON, hence the larger tier. */
    JSON_BODY_LIMIT: z.string().default('256kb'),
    UPLOAD_BODY_LIMIT: z.string().default('4mb'),

    /** Rate limiting. A window of zero requests disables a tier entirely. */
    RATE_LIMIT_WINDOW_SECONDS: positiveInt(60, 86_400),
    RATE_LIMIT_GLOBAL_MAX: positiveInt(600),
    RATE_LIMIT_AUTH_MAX: positiveInt(10),
    RATE_LIMIT_WRITE_MAX: positiveInt(120),
    RATE_LIMIT_REPORT_MAX: positiveInt(60),

    /** Longest a report aggregation may occupy a database server thread. */
    DB_QUERY_TIMEOUT_MS: positiveInt(20_000, 300_000),
    DB_MAX_POOL_SIZE: positiveInt(20, 500),

    /** Reported by `/health/version` and stamped on structured log lines. */
    APP_VERSION: z.string().default('1.0.0'),
    GIT_COMMIT: z.string().default('unknown'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') return;
    // A shipped example secret in production is the single most likely way for
    // this system to be compromised, so it is refused at boot rather than
    // warned about in a log nobody reads.
    //
    // Matched exactly against the values this repository has actually shipped,
    // not against words like "secret": a operator's own passphrase may well
    // contain that word, and refusing a legitimate secret would be worse than
    // useless — it teaches people to work around the check.
    const shipped = new Set([
      'your_super_secret_jwt_key',
      'your_super_secret_refresh_key',
      'development_only_jwt_secret_at_least_32_characters',
      'change_me',
    ]);
    for (const key of ['JWT_SECRET', 'REFRESH_TOKEN_SECRET'] as const) {
      const secret = value[key];
      if (secret && shipped.has(secret.trim().toLowerCase())) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'must not be the example value from .env.example in production',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * An empty assignment means "not configured", not "configured as nothing".
 *
 * `.env.example` lists every optional variable with an empty value so an
 * operator can see it exists — `REFRESH_TOKEN_SECRET=`, `REDIS_URL=` and so on.
 * dotenv turns those into empty strings rather than leaving them absent, so
 * without this an optional field is present-but-invalid and the process refuses
 * to start on a file the documentation told you to copy verbatim. Nothing in
 * the schema treats an empty string as meaningful, so dropping them here lets
 * `.optional()` and `.default()` behave the way the file reads.
 */
const withoutBlanks = (source: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(source).filter(([, value]) => value?.trim() !== ''));

export const validateEnv = (): Env => {
  const parsed = envSchema.safeParse(withoutBlanks(process.env));

  if (!parsed.success) {
    // Field names and reasons are printed; values never are, because a bad
    // value is frequently a secret that was pasted into the wrong variable.
    const problems = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    console.error(`Invalid environment configuration:\n${problems.join('\n')}`);
    process.exit(1);
  }

  return parsed.data;
};

export const env = validateEnv();

/** The refresh secret, resolved once so callers cannot disagree about it. */
export const refreshSecret = env.REFRESH_TOKEN_SECRET ?? `${env.JWT_SECRET}_refresh`;

export const isProduction = env.NODE_ENV === 'production';
