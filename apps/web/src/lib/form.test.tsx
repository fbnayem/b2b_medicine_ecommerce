// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LoginSchema } from '@medsupply/validation';
import { Field, Input } from '../components/ui';
import { useZodForm } from './form';

/**
 * A form refuses bad input before it costs a round trip.
 *
 * There was no form library and no client-side validation anywhere:
 * `@medsupply/validation` holds every schema the API enforces and was imported
 * by **zero** web files. A malformed phone number or a mistyped amount was
 * discovered by submitting, waiting, and reading a sentence at the top of the
 * page that could not point at the field — because the error envelope carries
 * no field-level detail, which is exactly why validating client-side is what
 * makes an inline message possible at all.
 *
 * Asserted against a real server schema rather than a fixture, since the whole
 * argument for reusing them is that a second copy of the rules drifts.
 */

function SignIn({ onValid }: { onValid: (values: { email: string; password: string }) => void }) {
  const form = useZodForm(LoginSchema);
  return (
    <form onSubmit={form.handleSubmit(onValid)} noValidate>
      <Field label="Email" error={form.formState.errors.email?.message}>
        <Input {...form.register('email')} />
      </Field>
      <Field label="Password" error={form.formState.errors.password?.message}>
        <Input type="password" {...form.register('password')} />
      </Field>
      <button type="submit">Sign in</button>
    </form>
  );
}

describe('useZodForm', () => {
  it('marks the offending field and does not submit', async () => {
    const onValid = vi.fn();
    render(<SignIn onValid={onValid} />);

    // Only the email is wrong, so exactly one field should complain — a form
    // that reddens every control because one is wrong teaches people to ignore
    // it.
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'CorrectHorse1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    // The message is attached to the field, announced, and the control is
    // marked invalid — all of which `Field` wires from one `error` prop.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBeTruthy();
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Password').getAttribute('aria-invalid')).toBeNull();
    expect(onValid).not.toHaveBeenCalled();
  });

  it('submits the parsed values once they are valid', async () => {
    const onValid = vi.fn();
    render(<SignIn onValid={onValid} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@shop.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'CorrectHorse1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(onValid).toHaveBeenCalledTimes(1));
    expect(onValid.mock.calls[0]?.[0]).toMatchObject({ email: 'owner@shop.test' });
  });

  it('clears the error as soon as the field is corrected', async () => {
    render(<SignIn onValid={vi.fn()} />);
    const email = screen.getByLabelText('Email');

    fireEvent.change(email, { target: { value: 'nope' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'CorrectHorse1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('alert');

    /*
     * `reValidateMode: 'onChange'` after the first failure. Validating on every
     * keystroke from the start marks a field red while somebody is halfway
     * through typing, which reads as the form arguing with them; leaving it on
     * submit-only means the error sits there after it has been fixed.
     */
    fireEvent.change(email, { target: { value: 'owner@shop.test' } });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
