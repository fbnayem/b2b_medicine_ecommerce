// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole, UserStatus } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import { SystemSettings } from './SystemSettings';
import { UserAdministration } from './UserAdministration';
import { AuditLogViewer } from './AuditLogViewer';

vi.mock('../api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() },
}));
vi.mock('../realtime/socket', () => ({
  onRealtime: () => () => {},
  connectRealtime: vi.fn(),
  disconnectRealtime: vi.fn(),
}));

const get = vi.mocked(apiClient.get);
const put = vi.mocked(apiClient.put);
const post = vi.mocked(apiClient.post);
const patch = vi.mocked(apiClient.patch);

const settingsPayload = {
  settings: {
    business: {
      name: 'MedSupply B2B',
      address: '12 Bijoy Sarani',
      phone: '+8801712345678',
      email: 'accounts@medsupply.test',
      invoiceFooter: 'Thank you.',
    },
    finance: {
      taxBasisPoints: 0,
      defaultPaymentTermsDays: 30,
      creditBlockOnLimitExceeded: true,
      creditBlockOverdueThresholdMinor: 0,
      creditOverdueGraceDays: 0,
      customerAdvanceEnabled: true,
      deliveryCollectionRequiresVerification: true,
    },
    inventory: { nearExpiryDays: 90, lowStockThreshold: 10 },
    delivery: { requiredProofs: ['OTP'], otpExpiryMinutes: 10 },
    notifications: {
      defaultQuietHours: { enabled: false, start: '22:00', end: '07:00' },
      overdueDigestEnabled: true,
      nearExpiryDigestEnabled: true,
    },
    localisation: {
      timezone: 'Asia/Dhaka',
      locale: 'en',
      dateFormat: 'DD MMM YYYY',
      currencyCode: 'BDT',
      currencySymbol: '৳',
    },
    security: {
      passwordMinLength: 8,
      maxLoginAttempts: 5,
      lockoutMinutes: 15,
      forcePasswordChangeOnCreate: true,
    },
  },
  sources: {
    business: 'DEFAULT',
    finance: 'ENVIRONMENT',
    inventory: 'PERSISTED',
    delivery: 'DEFAULT',
    notifications: 'DEFAULT',
    localisation: 'DEFAULT',
    security: 'DEFAULT',
  },
  versions: {
    business: 0,
    finance: 0,
    inventory: 3,
    delivery: 0,
    notifications: 0,
    localisation: 0,
    security: 0,
  },
  descriptions: {
    business: 'Identity printed on invoices.',
    finance: 'Tax, payment terms and credit control.',
    inventory: 'Near-expiry and low-stock thresholds.',
    delivery: 'Proof requirements.',
    notifications: 'Default quiet hours.',
    localisation: 'Time zone and display formatting.',
    security: 'Password and lockout policy.',
  },
  fallbacks: {},
};

beforeEach(() => {
  // Without this, a failed assertion leaves its tree mounted and every later
  // query in the file reports duplicate matches instead of the real problem.
  cleanup();
  get.mockReset();
  put.mockReset();
  post.mockReset();
  patch.mockReset();
  useAuthStore.setState({
    user: { _id: 'admin-1', role: UserRole.ADMIN } as never,
    accessToken: 'token',
    isAuthenticated: true,
  });
});

describe('SystemSettings', () => {
  it('renders effective values with their provenance and saves a group with its version', async () => {
    get.mockResolvedValue({ data: { data: settingsPayload } });
    put.mockResolvedValue({ data: { data: {} } });

    const view = render(
      <MemoryRouter>
        <SystemSettings />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Business identity' }),
    ).toBeTruthy();
    expect(screen.getByText('Built-in default')).toBeTruthy();

    const nameField = screen.getByLabelText('Display name') as HTMLInputElement;
    expect(nameField.value).toBe('MedSupply B2B');
    fireEvent.change(nameField, { target: { value: 'Dhaka Medical' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Business identity/ }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    const [url, body] = put.mock.calls[0] as [
      string,
      { values: Record<string, unknown>; version: number },
    ];
    expect(url).toBe('/settings/business');
    expect(body.version).toBe(0);
    expect(body.values.name).toBe('Dhaka Medical');
    view.unmount();
  });

  it('reports a concurrent change and reloads instead of overwriting it', async () => {
    get.mockResolvedValue({ data: { data: settingsPayload } });
    put.mockRejectedValue({
      response: { data: { error: { code: 'STALE_SETTINGS', message: 'stale' } } },
    });

    const view = render(
      <MemoryRouter>
        <SystemSettings />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Business identity' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Save Business identity/ }));

    expect(
      await screen.findByText(
        'Someone else changed these settings. The latest values have been reloaded.',
      ),
    ).toBeTruthy();
    view.unmount();
  });

  it('only offers a reset for a group that has a saved override', async () => {
    get.mockResolvedValue({ data: { data: settingsPayload } });
    const view = render(
      <MemoryRouter>
        <SystemSettings />
      </MemoryRouter>,
    );

    // Business falls back to the built-in default, so there is nothing to reset.
    const businessReset = (await screen.findByRole('button', {
      name: 'Reset to fallback',
    })) as HTMLButtonElement;
    expect(businessReset.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Inventory thresholds' }));
    const inventoryReset = screen.getByRole('button', {
      name: 'Reset to fallback',
    }) as HTMLButtonElement;
    expect(inventoryReset.disabled).toBe(false);
    view.unmount();
  });

  it('shows a permission-denied message rather than an empty form', async () => {
    get.mockRejectedValue({ response: { status: 403 } });
    const view = render(
      <MemoryRouter>
        <SystemSettings />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Your role cannot view system settings.')).toBeTruthy();
    view.unmount();
  });
});

describe('UserAdministration', () => {
  const directory = {
    data: [
      {
        _id: 'user-2',
        firstName: 'Nusrat',
        lastName: 'Jahan',
        email: 'nusrat@test.local',
        role: UserRole.STOREKEEPER,
        status: UserStatus.ACTIVE,
      },
      {
        _id: 'admin-1',
        firstName: 'Own',
        lastName: 'Account',
        email: 'admin@test.local',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    ],
    meta: { total: 2 },
  };

  it('changes a role through the API and reports the outcome', async () => {
    get.mockResolvedValue({ data: directory });
    patch.mockResolvedValue({ data: { data: {} } });

    const view = render(
      <MemoryRouter>
        <UserAdministration />
      </MemoryRouter>,
    );

    expect(await screen.findByText('nusrat@test.local')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Role for nusrat@test.local'), {
      target: { value: UserRole.MANAGER },
    });

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/admin/users/user-2', { role: UserRole.MANAGER }),
    );
    view.unmount();
  });

  it('disables role and status controls on your own account', async () => {
    get.mockResolvedValue({ data: directory });
    const view = render(
      <MemoryRouter>
        <UserAdministration />
      </MemoryRouter>,
    );

    const ownRole = (await screen.findByLabelText(
      'Role for admin@test.local',
    )) as HTMLSelectElement;
    const ownStatus = screen.getByLabelText('Status for admin@test.local') as HTMLSelectElement;
    expect(ownRole.disabled).toBe(true);
    expect(ownStatus.disabled).toBe(true);
    view.unmount();
  });

  it('surfaces a rejected change from the server', async () => {
    get.mockResolvedValue({ data: directory });
    patch.mockRejectedValue({
      response: {
        data: { error: { message: 'Only a Super Admin may grant the Admin role' } },
      },
    });

    const view = render(
      <MemoryRouter>
        <UserAdministration />
      </MemoryRouter>,
    );
    await screen.findByText('nusrat@test.local');
    fireEvent.change(screen.getByLabelText('Role for nusrat@test.local'), {
      target: { value: UserRole.ADMIN },
    });

    expect(await screen.findByText('Only a Super Admin may grant the Admin role')).toBeTruthy();
    view.unmount();
  });

  it('renders read-only controls for a Manager', async () => {
    useAuthStore.setState({
      user: { _id: 'manager-1', role: UserRole.MANAGER } as never,
      accessToken: 'token',
      isAuthenticated: true,
    });
    get.mockResolvedValue({ data: directory });

    const view = render(
      <MemoryRouter>
        <UserAdministration />
      </MemoryRouter>,
    );
    expect(await screen.findByText('nusrat@test.local')).toBeTruthy();
    expect(screen.queryByLabelText('Role for nusrat@test.local')).toBeNull();
    expect(screen.getAllByText('Read only').length).toBe(2);
    view.unmount();
  });
});

describe('AuditLogViewer', () => {
  it('lists records and expands the recorded detail on demand', async () => {
    get.mockImplementation((url: string) => {
      if (url === '/admin/audit/actions') {
        return Promise.resolve({ data: { data: ['SETTINGS_UPDATED', 'USER_ROLE_CHANGED'] } });
      }
      return Promise.resolve({
        data: {
          data: [
            {
              _id: 'audit-1',
              action: 'SETTINGS_UPDATED',
              entityType: 'SystemSetting',
              entityId: 'settings-business',
              actorId: { _id: 'admin-1', firstName: 'Farida', lastName: 'Khan' },
              actorRole: UserRole.ADMIN,
              before: { name: 'MedSupply B2B' },
              after: { name: 'Dhaka Medical' },
              createdAt: new Date().toISOString(),
            },
          ],
          meta: { total: 1 },
        },
      });
    });

    const view = render(
      <MemoryRouter>
        <AuditLogViewer />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText('SETTINGS UPDATED', { selector: 'p.notification-title' }),
    ).toBeTruthy();
    expect(screen.getByText(/Farida Khan/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show detail' }));
    expect(await screen.findByText(/Dhaka Medical/)).toBeTruthy();
    view.unmount();
  });

  it('explains a permission failure instead of showing an empty log', async () => {
    get.mockRejectedValue({ response: { status: 403 } });
    const view = render(
      <MemoryRouter>
        <AuditLogViewer />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Your role cannot read the audit log.')).toBeTruthy();
    view.unmount();
  });
});
