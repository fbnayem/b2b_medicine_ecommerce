import { landingRouteFor } from '@medsupply/navigation';
import type { UserRole } from '@medsupply/shared-types';
import { useAuthStore } from '../store/useAuth';
import { LinkButton, PageHeader } from '../components/ui';
import { useLanguage } from '../lib/useLanguage';

/**
 * A real "not found" screen.
 *
 * The catch-all previously redirected to `/login`, which is how the shop-owner
 * routing defect stayed invisible for twelve phases: a signed-in user reaching
 * a path that did not exist was silently returned to the sign-in form, so a
 * wrong link and a rejected password looked exactly the same.
 */
export function NotFound() {
  const { t } = useLanguage();
  const user = useAuthStore((state) => state.user);
  const home = user ? landingRouteFor(user.role as UserRole) : '/login';

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center p-6">
      <PageHeader
        routeId="not-found"
        title={t('errorPages.notFoundTitle')}
        description={t('errorPages.notFoundBody')}
      />
      <LinkButton variant="primary" to={home} className="w-fit">
        {t('common.goHome')}
      </LinkButton>
    </main>
  );
}
