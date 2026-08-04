import { catalogueFor, type Language } from '@medsupply/i18n';

/**
 * The parts of talking to this API that both clients must agree on.
 *
 * They had diverged, and not cosmetically:
 *
 *   - web guards its refresh interceptor against retrying `/auth/refresh`
 *     itself; **mobile does not**, so one expired session becomes an endless
 *     loop of refresh attempts;
 *   - neither guarded `/auth/login` until phase 2 found it on web, so a
 *     mistyped password made the interceptor attempt a refresh and the user was
 *     shown *that* failure — "No refresh token" — while being signed out of a
 *     session they had never established. **Mobile still did this.**
 *   - web sets a request timeout; mobile had none, so a request over a cellular
 *     connection that never answers hangs the screen indefinitely.
 *
 * The axios instance itself is deliberately *not* here: the two token stores
 * are genuinely different — an HTTP-only cookie the browser will not let us
 * read, and Expo SecureStore — and pretending otherwise would produce an
 * abstraction that fits neither. What is shared is the **policy**, which is
 * where the bugs were, plus the reading of a failure, which was being done by
 * around 29 ad-hoc casts.
 */

// ─── Reading a failure ───────────────────────────────────────────────────────

export interface ApiFailure {
  /** The server's machine-readable code, when it gave one. */
  code: string;
  /** The server's own message. Not necessarily fit to show a user. */
  message?: string;
  /** HTTP status, when the request reached the server at all. */
  status?: number;
  /**
   * The correlation identifier the API attaches to every failure.
   *
   * The backend has emitted this on every error since phase 12 and **it reached
   * no user**, so a support call could name the time something failed but never
   * the request.
   */
  reference?: string;
}

interface AxiosLikeError {
  response?: {
    status?: number;
    data?: { error?: { code?: string; message?: string; correlationId?: string } };
  };
  code?: string;
  message?: string;
}

/**
 * Normalises whatever was thrown into something with a shape.
 *
 * Replaces the `(caught as { response?: { data?: { error?: { message?: string } } } })`
 * cast that appears about 29 times across the two applications, each written
 * slightly differently.
 */
export function apiFailure(caught: unknown): ApiFailure {
  const error = caught as AxiosLikeError | undefined;
  const body = error?.response?.data?.error;

  if (body?.code || body?.message) {
    return {
      code: body.code ?? 'UNKNOWN',
      message: body.message,
      status: error?.response?.status,
      reference: body.correlationId,
    };
  }

  // No response at all: the request never arrived, or never came back. Those
  // are different from a server refusal and must not read the same.
  if (error?.code === 'ECONNABORTED' || /timeout/i.test(error?.message ?? '')) {
    return { code: 'TIMEOUT', message: error?.message };
  }
  if (error?.response === undefined) {
    return { code: 'NETWORK', message: error?.message };
  }

  /*
   * A response with no error body still says something useful in its status,
   * and "you are not allowed to do that" must not be rendered as "something
   * went wrong" — those lead to different next actions. Pages used to hand-code
   * this per screen ("Your role cannot view returns."), which is why the same
   * refusal was worded differently on every page that bothered.
   */
  const status = error?.response?.status;
  const byStatus: Record<number, string> = {
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    429: 'RATE_LIMITED',
  };
  return {
    code: (status === undefined ? undefined : byStatus[status]) ?? 'UNKNOWN',
    message: error?.message,
    status,
  };
}

/** The correlation identifier, so a person can quote it. */
export function failureReference(caught: unknown): string | undefined {
  return apiFailure(caught).reference;
}

/**
 * A sentence the person at the keyboard can act on.
 *
 * Server codes were rendered verbatim: a shop owner whose order exceeded their
 * limit was shown `CREDIT_LIMIT_EXCEEDED`. The catalogue is consulted first and
 * the server's own message second — the server writes for a developer, the
 * catalogue writes for a shop owner.
 */
export function errorMessage(
  caught: unknown,
  language: Language = 'en',
  fallback?: string,
): string {
  const failure = apiFailure(caught);
  const catalogue = catalogueFor(language).errors;

  if (failure.code === 'TIMEOUT' || failure.code === 'NETWORK') {
    return language === 'bn'
      ? 'সার্ভারের সঙ্গে যোগাযোগ করা যাচ্ছে না। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।'
      : 'Could not reach the server. Check the connection and try again.';
  }

  return catalogue[failure.code] ?? failure.message ?? fallback ?? catalogue.UNKNOWN;
}

// ─── Refresh policy ──────────────────────────────────────────────────────────

/**
 * Endpoints where 401 means "these credentials are wrong", never "this access
 * token expired".
 *
 * Both must be here. Refresh, because retrying a failed refresh through the
 * refresh path is an infinite loop. Sign-in, because a mistyped password is not
 * an expired session, and treating it as one replaces "that password is wrong"
 * with a sentence about a mechanism the user has never heard of.
 */
export const CREDENTIAL_PATHS = ['/auth/refresh', '/auth/login', '/auth/change-password'] as const;

export function isCredentialPath(url: string | undefined): boolean {
  if (!url) return false;
  return CREDENTIAL_PATHS.some((path) => url.includes(path));
}

/**
 * Whether a failed request should be retried after refreshing the access token.
 *
 * One function, so the two clients cannot answer it differently again.
 */
export function shouldAttemptRefresh(input: {
  status?: number;
  url?: string;
  alreadyRetried?: boolean;
}): boolean {
  if (input.status !== 401) return false;
  if (input.alreadyRetried) return false;
  return !isCredentialPath(input.url);
}

/**
 * How long to wait before giving up on a request.
 *
 * Sixty seconds because the slowest legitimate call in this system is a report
 * over a rural cellular connection. Mobile had no timeout at all, so such a
 * request could hang a rider's screen with a spinner and no way back.
 */
export const REQUEST_TIMEOUT_MS = 60_000;

/** Correlates a user action with the server log line it produced. */
export function correlationId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
