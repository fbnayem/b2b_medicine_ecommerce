// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UserRole, UserStatus } from '@medsupply/shared-types';
import { landingRouteFor } from '@medsupply/navigation';
import { renderWithUi } from '../testing/render';
import { useAuthStore } from '../store/useAuth';
import { FrontDoor } from './FrontDoor';

/**
 * The front door.
 *
 * `/` had no route at all, so it fell to the catch-all and answered "That page
 * does not exist" — to anyone who typed the bare address, followed a bookmark
 * of the site, or opened a deployment at its root.
 *
 * These mount the same shape `App.tsx` does: `/` on one side, and a stand-in
 * for each destination on the other, so the assertion is about *where a person
 * ends up* rather than about which component was constructed.
 */

function mount() {
  return renderWithUi(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<FrontDoor />} />
        <Route path="/login" element={<p>the sign-in form</p>} />
        <Route path="/dashboard" element={<p>the home screen</p>} />
        <Route path="*" element={<p>that page does not exist</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function signIn(role: UserRole) {
  useAuthStore.setState({
    user: {
      _id: 'u1',
      email: 'user@test.local',
      firstName: 'Test',
      lastName: 'User',
      role,
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    accessToken: 'token',
    isAuthenticated: true,
    status: 'ready',
  });
}

beforeEach(() => {
  useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false, status: 'ready' });
});
afterEach(cleanup);

describe('the address of the application', () => {
  it('never answers the front door with "that page does not exist"', () => {
    mount();
    expect(screen.queryByText('that page does not exist')).toBeNull();
  });

  it('sends a visitor who is not signed in to the sign-in form', () => {
    mount();
    expect(screen.getByText('the sign-in form')).toBeTruthy();
  });

  it('sends every signed-in role to the screen their sign-in would have', () => {
    /*
     * Every role lands on `/dashboard` today, and that is exactly why this is
     * written against `landingRouteFor` rather than the literal: the day one
     * role is given a different home, the front door has to follow it without
     * anybody remembering this file.
     */
    for (const role of Object.values(UserRole)) {
      signIn(role);
      mount();
      expect(landingRouteFor(role), `${role} lands somewhere this test can see`).toBe('/dashboard');
      expect(screen.getByText('the home screen'), `${role} reaches their home screen`).toBeTruthy();
      cleanup();
    }
  });
});
