import { useState } from 'react';
import { toast } from '../components';
import { useLanguage } from '../i18n/useLanguage';
import type { SaveOutcome } from './names';

/**
 * The four screens that hand a file over share one shape: a button that goes
 * busy, a share sheet, and a sentence if it did not work.
 *
 * Written once because getting it wrong four times is the ordinary outcome —
 * in particular leaving the button spinning when the share sheet is dismissed,
 * which looks exactly like a download that never finished.
 */
export function useSaveDocument() {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);

  async function save(run: () => Promise<SaveOutcome>): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const outcome = await run();
      // There is no success message. The share sheet *is* the confirmation, and
      // a toast underneath it would be read by nobody.
      if (!outcome.ok) toast.error(t(outcome.problem));
    } catch {
      toast.error(t('documents.couldNotFetch'));
    } finally {
      setBusy(false);
    }
  }

  return { busy, save };
}
