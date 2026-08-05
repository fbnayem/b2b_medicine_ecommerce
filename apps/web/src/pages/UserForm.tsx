import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserRole } from '@medsupply/shared-types';
import { apiClient, errorMessage, failureReference } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import { creatableRoles } from '../lib/permissions';
import {
  Button,
  Card,
  ErrorState,
  Field,
  HelpTip,
  Input,
  LinkButton,
  PageHeader,
  Select,
  toast,
} from '../components/ui';
import { useQueryClient } from '@tanstack/react-query';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';

/**
 * Bringing somebody into the system, which nothing here could do.
 *
 * `POST /api/v1/users` works, is documented and has been covered by an
 * integration test since phase 22 — and **has never had a caller.** There was
 * no page, no route and no form. Riders, storekeepers and administrators
 * existed because the seed script made them, and the user directory could
 * change a role and reset a password but never add a person.
 *
 * **A rider is nothing more than a `User` with the role `DELIVERY_PERSON`.**
 * There is no `Rider`, `Vehicle` or `Licence` model anywhere in this codebase,
 * and the vehicle on a round is free text on the trip. So the dialog version of
 * this form fixes the role and shows four fields, and the page version offers
 * the roles the viewer is actually permitted to grant.
 *
 * The password is a real one, typed once by whoever is setting the account up
 * and changed by its owner at first sign-in — `forcePasswordChangeOnCreate` is
 * a security setting the server already applies. Nothing is generated here and
 * nothing is echoed back twice: the minimum length is the tenant's own policy,
 * and the server refuses anything shorter with a message that names it.
 */

export interface UserFormProps {
  /**
   * `page` navigates to the directory on success; `dialog` hands the new id
   * back to whoever opened it and shows a toast instead.
   */
  mode?: 'page' | 'dialog';
  /** Fixed and hidden, for a picker that knows what it is asking for. */
  fixedRole?: UserRole;
  onCreated?: (id: string) => void;
  onCancel?: () => void;
}

const EMPTY = { firstName: '', lastName: '', email: '', password: '' };

export function UserForm({ mode = 'page', fixedRole, onCreated, onCancel }: UserFormProps) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const actor = useAuthStore((state) => state.user?.role);

  const allowed = creatableRoles(actor);
  const [form, setForm] = useState(EMPTY);
  const [role, setRole] = useState<UserRole>(fixedRole ?? allowed[0] ?? UserRole.DELIVERY_PERSON);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();

  const set = (key: keyof typeof EMPTY) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(undefined);
    setSaving(true);
    try {
      const response = await apiClient.post('/users', { ...form, role: fixedRole ?? role });
      // The directory, and every picker reading the same people.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.users.all }),
        queryClient.invalidateQueries({ queryKey: keys.riders.all }),
      ]);
      const created = response.data.data;
      toast.success(t('people.added', { name: `${form.firstName} ${form.lastName}` }));
      setForm(EMPTY);
      if (onCreated) onCreated(created._id);
      else navigate('/admin/users');
    } catch (caught) {
      setFailure({
        message: errorMessage(caught, language, t('people.addFailed')),
        reference: failureReference(caught),
      });
    } finally {
      setSaving(false);
    }
  }

  const fields = (
    <>
      {failure && <ErrorState message={failure.message} reference={failure.reference} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('people.firstName')} required>
          <Input required value={form.firstName} onChange={set('firstName')} />
        </Field>
        <Field label={t('people.lastName')} required>
          <Input required value={form.lastName} onChange={set('lastName')} />
        </Field>
        <Field
          label={t('people.email')}
          hint={t('people.emailHint')}
          required
          help={
            <HelpTip
              label={t('people.about', { field: t('people.email') })}
              body={t('people.emailHelp')}
            />
          }
        >
          <Input
            required
            type="email"
            autoComplete="off"
            value={form.email}
            onChange={set('email')}
          />
        </Field>
        <Field
          label={t('people.password')}
          hint={t('people.passwordHint')}
          required
          help={
            <HelpTip
              label={t('people.about', { field: t('people.password') })}
              body={t('people.passwordHelp')}
            />
          }
        >
          {/*
            `new-password`, so a browser does not offer the person setting this
            up their own saved credential — which is how an account ends up
            sharing a password with the administrator who created it.
          */}
          <Input
            required
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
          />
        </Field>

        {/*
          Absent, not disabled, when the picker already knows the answer. A
          control with one option is a question nobody was asked.
        */}
        {!fixedRole && (
          <Field
            label={t('people.role')}
            required
            help={
              <HelpTip
                label={t('people.about', { field: t('people.role') })}
                body={t('people.roleHelp')}
              />
            }
          >
            <Select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
              {allowed.map((option) => (
                <option key={option} value={option}>
                  {t(`roles.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </>
  );

  const actions = (
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" onClick={() => (onCancel ? onCancel() : navigate('/admin/users'))}>
        {t('common.cancel')}
      </Button>
      <Button type="submit" variant="primary" busy={saving}>
        {t('people.add')}
      </Button>
    </div>
  );

  if (mode === 'dialog') {
    return (
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        {fields}
        {actions}
      </form>
    );
  }

  return (
    <>
      <PageHeader
        routeId="user-new"
        title={t('people.addTitle')}
        description={t('people.addSubtitle')}
        actions={<LinkButton to="/admin/users">{t('people.directory')}</LinkButton>}
      />
      <Card className="max-w-3xl">
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          {fields}
          {actions}
        </form>
      </Card>
    </>
  );
}
