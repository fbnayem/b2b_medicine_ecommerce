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
 *
 * The screen then told everybody "You are still signed in." — a signed-out
 * visitor included, above a button that took them to the sign-in form. Both
 * halves of the sentence now depend on which of the two is actually true.
 */
export function NotFound() {
  const { t } = useLanguage();
  const user = useAuthStore((state) => state.user);
  const home = user ? landingRouteFor(user.role as UserRole) : '/login';
  const standing = user ? t('errorPages.notFoundSignedIn') : t('errorPages.notFoundSignedOut');

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center p-6">
      <PageHeader
        routeId="not-found"
        title={t('errorPages.notFoundTitle')}
        description={`${t('errorPages.notFoundBody')} ${standing}`}
      />
      <LinkButton variant="primary" to={home} className="w-fit">
        {user ? t('common.goHome') : t('common.signIn')}
      </LinkButton>
    </main>
  );
}
