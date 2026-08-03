import React, { useEffect } from 'react';
import { Link, Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../store/useAuth';
import { UserRole } from '@medsupply/shared-types';
import { NotificationBell } from './NotificationBell';
import { connectRealtime, disconnectRealtime } from '../realtime/socket';
import { signOut } from '../api/client';

interface ProtectedRouteProps {
  allowedRoles?: UserRole[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles }) => {
  const { isAuthenticated, user } = useAuthStore();

  // One realtime connection for the whole authenticated session.
  useEffect(() => {
    if (!isAuthenticated) return;
    connectRealtime();
    return () => disconnectRealtime();
  }, [isAuthenticated]);

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return (
    <>
      <div className="app-utility-bar">
        <Link to="/dashboard" className="app-brand">
          MedSupply B2B
        </Link>
        <div className="app-utility-actions">
          <Link to="/activity">Activity</Link>
          <NotificationBell />
          {/* Until now the only way out was "Sign out everywhere" in the
              security centre, and that button only rendered for a user with
              more than one session — so a warehouse terminal signed in once
              could not be signed out at all. */}
          <button type="button" className="link-button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
      <Outlet />
    </>
  );
};
