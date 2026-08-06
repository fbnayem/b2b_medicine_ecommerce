import { useId } from 'react';
import { BookOpen } from 'lucide-react';
import { useLanguage } from '../../lib/useLanguage';
import { guideFor } from '../../lib/pageGuides';

/**
 * What this screen is for, what to put into it, and how its figures are worked
 * out — in the words of somebody who has never seen it before.
 *
 * The people who use this product are pharmacy owners, storekeepers and
 * delivery riders, not the person who specified it. A screen called "Free-goods
 * offers" with a field called "Sold as" is perfectly clear to whoever wrote it
 * and answers nothing for the shop owner meeting it at seven in the morning.
 * Every one of those readers had exactly one way to find out what a control did:
 * ask somebody.
 *
 * ## Three questions, in this order
 *
 * **What this page is for** — the job it does, in one or two sentences, using
 * the words a shop uses rather than the words the database uses.
 *
 * **How to use it** — what to type, in what order, and what happens when you
 * press the button. This is the part that replaces asking somebody.
 *
 * **How the figures are worked out** — only on screens that show a number
 * somebody could disagree with. A price, a total, an ageing bucket, a margin.
 * Where a screen computes nothing, this is left out rather than filled with a
 * sentence saying so.
 *
 * ## Why it is at the bottom, and always open
 *
 * At the bottom because it is the least urgent thing on the page and must never
 * push the work below the fold. Always open — not behind a disclosure — because
 * a panel somebody has to know to open is a panel that answers nothing for the
 * person who did not know there was a question. It costs nothing above the fold
 * either way.
 *
 * ## Why the shell renders it and pages do not
 *
 * `AppShell` renders one of these under the outlet, resolving the content from
 * the route. Sixty-four pages pasting the same block is sixty-four chances to
 * forget it, and the forty-fourth page written next year would simply not have
 * one. This way a screen without guidance fails `pageGuides.test.ts` instead.
 *
 * Hidden from print through the shared `data-print="hide"` contract: guidance
 * is chrome, and an invoice does not want a paragraph explaining invoices.
 */
export function PageGuide({ routeId }: { routeId: string | undefined }) {
  const { t } = useLanguage();
  const heading = useId();
  const guide = routeId ? guideFor(routeId, t) : undefined;

  // Screens with nothing to explain — the not-found and permission-denied
  // pages — render nothing rather than an empty frame.
  if (!guide) return null;

  return (
    <section
      aria-labelledby={heading}
      data-test="page-guide"
      data-print="hide"
      className="mt-10 rounded-panel border border-border bg-surface-sunken p-4 sm:p-5"
    >
      <h2
        id={heading}
        className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-text-muted"
      >
        <BookOpen aria-hidden="true" size={16} />
        {t('guide.heading')}
      </h2>

      {/*
        A description list, because that is what this is: three questions and
        their answers. A screen reader can then move between the questions
        rather than through one wall of prose.
      */}
      <dl className="mt-3 grid gap-4 md:grid-cols-3">
        <div>
          <dt className="text-sm font-semibold text-text">{t('guide.whatLabel')}</dt>
          <dd className="mt-1 text-sm text-text-muted">{guide.what}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-text">{t('guide.useLabel')}</dt>
          <dd className="mt-1 text-sm text-text-muted">{guide.use}</dd>
        </div>
        {guide.maths && (
          <div>
            <dt className="text-sm font-semibold text-text">{t('guide.mathsLabel')}</dt>
            <dd className="mt-1 text-sm text-text-muted">{guide.maths}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
