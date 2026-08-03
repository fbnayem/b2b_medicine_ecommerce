import { Navigate, Outlet } from 'react-router-dom';
import type { UserRole } from '@medsupply/shared-types';
import { useAuthStore } from '../store/useAuth';

/**
 * Whether this person may see this page. Twelve lines, one job.
 *
 * Sits **outside** the lazy boundary in `App.tsx`, so an unauthorised role is
 * turned away before their browser downloads the chunk — a shop owner should
 * not have the administration bundle on their laptop, refused or not.
 */
export function RoleGate({ allowedRoles }: { allowedRoles: readonly UserRole[] }) {
  const user = useAuthStore((state) => state.user);
  if (!user) return <Navigate to="/login" replace />;
  if (!allowedRoles.includes(user.role as UserRole)) {
    return <Navigate to="/unauthorized" replace />;
  }
  return <Outlet />;
}
