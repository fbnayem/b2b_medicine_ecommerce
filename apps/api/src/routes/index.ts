import type { Router } from 'express';
import activityRoutes from './activityRoutes';
import adminRoutes from './adminRoutes';
import approvalRoutes from './approvalRoutes';
import authRoutes from './authRoutes';
import deliveryRoutes from './deliveryRoutes';
import docsRoutes from './docsRoutes';
import financeRoutes from './financeRoutes';
import fulfilmentRoutes from './fulfilmentRoutes';
import inventoryRoutes from './inventoryRoutes';
import notificationRoutes from './notificationRoutes';
import orderRoutes from './orderRoutes';
import paymentRoutes from './paymentRoutes';
import purchasingRoutes from './purchasingRoutes';
import reportRoutes from './reportRoutes';
import returnRoutes from './returnRoutes';
import settingsRoutes from './settingsRoutes';
import shopRoutes from './shopRoutes';
import userRoutes from './userRoutes';

/**
 * Which rate-limit tier a mount sits behind. Named rather than passed as
 * middleware so this table stays importable by tooling that must not construct
 * a limiter — the route-coverage reconciliation reads it, and building a
 * limiter would open a Redis connection just to count paths.
 */
export type MountTier = 'none' | 'write' | 'report';

export interface ApiMount {
  prefix: string;
  router: Router;
  tier: MountTier;
}

/**
 * Every mounted router, as data.
 *
 * Express keeps no record of the path a router was mounted at — `layer.path` is
 * populated only while a request is being matched — so a sequence of
 * `app.use('/api/v1/x', xRoutes)` calls is write-only: nothing can later ask
 * the application what its route surface is. Declaring the mounts here makes
 * the surface enumerable, which is what `routeCoverage.test.ts` needs to
 * reconcile the real router against the OpenAPI document and against the
 * integration suite. `app.ts` mounts from this list and adds nothing to it.
 */
export const API_MOUNTS: readonly ApiMount[] = [
  { prefix: '/api/v1/docs', router: docsRoutes, tier: 'none' },
  { prefix: '/api/v1/auth', router: authRoutes, tier: 'none' },
  { prefix: '/api/v1/users', router: userRoutes, tier: 'write' },
  { prefix: '/api/v1/shops', router: shopRoutes, tier: 'write' },
  { prefix: '/api/v1/inventory', router: inventoryRoutes, tier: 'write' },
  { prefix: '/api/v1/orders', router: orderRoutes, tier: 'write' },
  { prefix: '/api/v1/approvals', router: approvalRoutes, tier: 'write' },
  { prefix: '/api/v1/fulfilment', router: fulfilmentRoutes, tier: 'write' },
  { prefix: '/api/v1/deliveries', router: deliveryRoutes, tier: 'write' },
  { prefix: '/api/v1/payments', router: paymentRoutes, tier: 'write' },
  { prefix: '/api/v1/finance', router: financeRoutes, tier: 'none' },
  { prefix: '/api/v1/notifications', router: notificationRoutes, tier: 'none' },
  { prefix: '/api/v1/activity', router: activityRoutes, tier: 'none' },
  { prefix: '/api/v1/settings', router: settingsRoutes, tier: 'write' },
  { prefix: '/api/v1/admin', router: adminRoutes, tier: 'write' },
  { prefix: '/api/v1/returns', router: returnRoutes, tier: 'write' },
  { prefix: '/api/v1/purchasing', router: purchasingRoutes, tier: 'write' },
  // Every report recomputes from source records, so these are the most
  // expensive reads in the system and carry their own budget.
  { prefix: '/api/v1/reports', router: reportRoutes, tier: 'report' },
];

/**
 * Routes mounted directly on the application rather than through a router.
 * They sit ahead of the rate limiter so a degraded process can still answer a
 * probe, which is why they are not in `API_MOUNTS`.
 */
export const HEALTH_ROUTES = [
  { method: 'get', path: '/health' },
  { method: 'get', path: '/health/ready' },
  { method: 'get', path: '/health/version' },
  { method: 'get', path: '/metrics' },
] as const;
