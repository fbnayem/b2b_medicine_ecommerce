import { landingRouteFor } from '@medsupply/navigation';
import type { UserRole } from '@medsupply/shared-types';
import { useAuthStore } from '../store/useAuth';
import { LinkButton, PageHeader } from '../components/ui';
import { useLanguage } from '../lib/useLanguage';

/**
 * A refusal, said plainly.
 *
 * It sends people to *their* home screen rather than to `/dashboard`, which is
 * not where every role lands — a delivery person sent there would meet a second
 * refusal, which reads as the application being broken rather than as a
 * permission boundary.
 */
export function Unauthorized() {
  const { t } = useLanguage();
  const user = useAuthStore((state) => state.user);
  const home = user ? landingRouteFor(user.role as UserRole) : '/login';

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center p-6">
      <div role="alert">
        <PageHeader
          routeId="unauthorized"
          title={t('errorPages.forbiddenTitle')}
          description={t('errorPages.forbiddenBody')}
        />
      </div>
      <LinkButton variant="primary" to={home} className="w-fit">
        {t('errorPages.backToDashboard')}
      </LinkButton>
    </main>
  );
}
