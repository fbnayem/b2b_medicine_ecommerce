/**
 * Raises the rate-limit budgets for the seed process only.
 *
 * The seed signs in as every role and then drives a whole order lifecycle
 * through the HTTP API, which is exactly the traffic shape the auth limiter
 * exists to refuse — a second run inside the same window hits `429` on the
 * first sign-in and the seed dies having created accounts but no data.
 *
 * Imported before `app` so the values are in place when `env` is read.
 *
 * Assigned unconditionally rather than defaulted with `??=`: `.env` sets all
 * four, so a default would be a no-op and the seed would keep dying on its
 * eighth sign-in. This process listens on an ephemeral loopback port, serves
 * only itself and exits, so there is no budget here worth defending — the
 * limiter guards the deployed API, and that reads its own environment.
 */
process.env.RATE_LIMIT_GLOBAL_MAX = '1000000';
process.env.RATE_LIMIT_AUTH_MAX = '1000000';
process.env.RATE_LIMIT_WRITE_MAX = '1000000';
process.env.RATE_LIMIT_REPORT_MAX = '1000000';
