import { render, screen, fireEvent } from '@testing-library/react-native';
import { Button, Field, Input } from './Controls';
import { layout } from '../theme';

/**
 * The first test in this package that renders anything.
 *
 * Phase 20 built these primitives and covered them with the typecheck and the
 * token gate — neither of which can see whether a button is reachable, labelled
 * or the right size. Those are the three properties that actually matter to
 * somebody using this outdoors, one-handed, through a glove.
 *
 * **`render` and `fireEvent` are `async` in React Native Testing Library 14.**
 * Forgetting the `await` does not fail loudly: `render` returns a pending
 * promise, `screen` is never populated, and every query throws "`render`
 * function has not been called" — which reads like a setup problem rather than
 * a missing keyword. Version 14 is not optional here, because it is the release
 * that dropped `react-test-renderer`, and that package does not support React
 * 19 — which this app is on.
 */

describe('Button', () => {
  it('is a button to a screen reader, with its label as its name', async () => {
    await render(<Button label="Confirm delivery" onPress={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Confirm delivery' })).toBeTruthy();
  });

  it('meets the 44px tap target the tokens set', async () => {
    await render(<Button label="Pick" onPress={() => undefined} />);
    // A Pressable's `style` is a function of press state, so this reads what
    // was actually applied rather than what was passed in.
    const applied = Object.assign({}, ...[screen.getByRole('button').props.style].flat(2));
    expect(applied.minHeight).toBe(layout.minTapTarget);
    expect(layout.minTapTarget).toBeGreaterThanOrEqual(44);
  });

  it('does not fire while busy, so a double tap cannot double-post', async () => {
    // This is money on the finance screens and a stock movement on the
    // warehouse ones. The second press must not reach the handler.
    const onPress = jest.fn();
    await render(<Button label="Record payment" onPress={onPress} busy />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('announces that it is busy rather than only looking it', async () => {
    await render(<Button label="Save" onPress={() => undefined} busy />);
    expect(screen.getByRole('button').props.accessibilityState).toMatchObject({ busy: true });
  });

  it('fires once when it is not busy, so the gate above is not vacuous', async () => {
    const onPress = jest.fn();
    await render(<Button label="Save" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('Field', () => {
  it('shows the hint when there is no error', async () => {
    await render(
      <Field label="Amount" hint="Taka and paisa">
        <Input label="Amount" />
      </Field>,
    );
    expect(screen.getByText('Taka and paisa')).toBeTruthy();
  });

  it('replaces the hint with the error and raises it as an alert', async () => {
    await render(
      <Field label="Amount" hint="Taka and paisa" error="Enter an amount like 12.50.">
        <Input label="Amount" />
      </Field>,
    );
    expect(screen.queryByText('Taka and paisa')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an amount like 12.50.');
  });
});

describe('Input', () => {
  it('carries its own accessible name', async () => {
    // React Native does not associate a nearby <Text> with a TextInput the way
    // `<label for>` does, so an input without this is genuinely unlabelled.
    await render(<Input label="Batch number" />);
    expect(screen.getByLabelText('Batch number')).toBeTruthy();
  });
});
