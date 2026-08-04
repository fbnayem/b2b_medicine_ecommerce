import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';
import { AskProvider, useAsk, requireReason } from './Ask';
import { Button } from './Controls';

/**
 * The dialog that replaces `Alert.alert` on the money and stock actions.
 *
 * These assertions are the reason the component exists. `Alert` renders outside
 * React, so a test could not see it at all — which meant a passing test proved
 * nothing about whether posting a collection to the ledger had been confirmed
 * or silently cancelled. That is exactly the defect phase 21 found on the web
 * client's sign-out control, where `window.confirm` let a test pass while
 * cancelling the very action it claimed to exercise.
 */

const translate = (path: string, values?: Record<string, string | number>) =>
  path === 'actions.reasonTooShort' ? `Give at least ${values?.minimum} characters.` : path;

/** Records what the promise settled to, so the test can assert on the answer. */
function Harness({ run }: { run: (ask: ReturnType<typeof useAsk>) => Promise<unknown> }) {
  const ask = useAsk();
  const [answer, setAnswer] = useState<string>('pending');
  return (
    <>
      <Button
        label="Start"
        onPress={() =>
          void run(ask).then(
            (value) => setAnswer(String(value)),
            () => setAnswer('rejected'),
          )
        }
      />
      <Text>answer:{answer}</Text>
    </>
  );
}

async function open(run: (ask: ReturnType<typeof useAsk>) => Promise<unknown>) {
  await render(
    <AskProvider>
      <Harness run={run} />
    </AskProvider>,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Start' }));
}

describe('confirm', () => {
  it('resolves true when the action is confirmed', async () => {
    await open((ask) =>
      ask.confirm({
        title: 'Post collection?',
        description: 'This posts to the customer ledger.',
        confirmLabel: 'Post',
      }),
    );
    expect(screen.getByText('Post collection?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(screen.getByText('answer:true')).toBeTruthy());
  });

  it('resolves false when it is cancelled, and the dialog goes away', async () => {
    // The half that matters: a cancelled confirmation must not read as a
    // performed action anywhere downstream.
    await open((ask) =>
      ask.confirm({
        title: 'Post collection?',
        description: 'To the ledger.',
        confirmLabel: 'Post',
      }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByText('answer:false')).toBeTruthy());
    expect(screen.queryByText('Post collection?')).toBeNull();
  });
});

describe('prompt', () => {
  it('resolves the typed value', async () => {
    await open((ask) =>
      ask.prompt({ title: 'Why?', label: 'Reason', confirmLabel: 'Save', multiline: true }),
    );
    await fireEvent.changeText(screen.getByLabelText('Reason'), 'Damaged in transit');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('answer:Damaged in transit')).toBeTruthy());
  });

  it('resolves null when cancelled, never an empty string', async () => {
    // An empty string is a value. If cancelling produced one, a caller checking
    // `if (!reason) return` would be the only thing standing between a cancel
    // and a posted transaction carrying no reason at all.
    await open((ask) => ask.prompt({ title: 'Why?', label: 'Reason', confirmLabel: 'Save' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByText('answer:null')).toBeTruthy());
  });

  it('refuses a reason that is too short, and says so in the catalogue’s words', async () => {
    await open((ask) =>
      ask.prompt({
        title: 'Why?',
        label: 'Reason',
        confirmLabel: 'Save',
        validate: requireReason(translate),
      }),
    );
    await fireEvent.changeText(screen.getByLabelText('Reason'), 'no');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Give at least 5 characters.')).toBeTruthy();
    // Still open, still unsettled — the promise must not resolve on a refusal.
    expect(screen.getByText('answer:pending')).toBeTruthy();
  });

  it('clears the error as soon as the text changes', async () => {
    await open((ask) =>
      ask.prompt({
        title: 'Why?',
        label: 'Reason',
        confirmLabel: 'Save',
        validate: requireReason(translate),
      }),
    );
    await fireEvent.changeText(screen.getByLabelText('Reason'), 'no');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await fireEvent.changeText(screen.getByLabelText('Reason'), 'Damaged in transit');
    expect(screen.queryByText('Give at least 5 characters.')).toBeNull();
  });
});

describe('choose', () => {
  it('resolves the chosen option, in the words the storekeeper read', async () => {
    await open((ask) =>
      ask.choose({
        title: 'Record a change to batch B-114',
        options: [
          { value: 'ADDITION', label: 'Added' },
          { value: 'QUARANTINE', label: 'Held back', danger: true },
        ],
      }),
    );
    // The value posted is the enum; the button says what it means. The stock
    // screen this replaces rendered `QUARANTINE_RELEASE` at the storekeeper.
    await fireEvent.press(screen.getByRole('button', { name: 'Held back' }));
    await waitFor(() => expect(screen.getByText('answer:QUARANTINE')).toBeTruthy());
  });

  it('resolves null when cancelled, so no movement is recorded', async () => {
    await open((ask) =>
      ask.choose({ title: 'Pick one', options: [{ value: 'ADDITION', label: 'Added' }] }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByText('answer:null')).toBeTruthy());
  });
});

describe('without a provider', () => {
  it('rejects rather than resolving, so nothing reads as confirmed', async () => {
    // Silently resolving would be the worst outcome: the action would look
    // confirmed and nothing would have happened.
    await render(
      <Harness run={(ask) => ask.confirm({ title: 'x', description: 'y', confirmLabel: 'z' })} />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(screen.getByText('answer:rejected')).toBeTruthy());
  });
});
