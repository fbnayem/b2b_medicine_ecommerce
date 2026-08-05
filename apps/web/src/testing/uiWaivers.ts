/**
 * The burn-down lists for `uiDiscipline.test.ts`.
 *
 * Phase 3 built a design system, a token package and a translation catalogue,
 * and the page bodies adopted almost none of it: no page used the table
 * primitive, none called `toast()`, three rendered `PageHeader` and none called
 * the translation function. That did not happen because anybody decided
 * against it. It happened because **nothing failed when a page skipped it** —
 * the same reason `POST /api/v1/users` shipped a role bug through twelve
 * phases with no test calling it.
 *
 * So these lists work exactly like `routeCoverage.waivers.ts`:
 *
 *   - Every entry is a page shipping without the guarantee, named individually.
 *     A percentage would hide *which* pages, and which page it is has been the
 *     deciding detail every time in this repository.
 *   - Adding an entry is a deliberate act, reviewed like any other change. The
 *     forty-fourth page cannot quietly join the old world.
 *   - Removing one is forced: the moment a page complies, the test fails on the
 *     stale waiver until it is struck off. **The lists can only shrink.**
 *
 * **Every list is now empty, and that is the finished state rather than a
 * starting one.** They were seeded at 36, 20, 29, 40 and 43 entries; phase 21
 * converted all forty-three pages and struck each one off as it complied.
 * `inventory.css` was deleted when the first list reached zero.
 *
 * The lists stay because the rules need them: an empty allow-list is what
 * makes the forty-fourth page fail rather than quietly joining the old world.
 * Adding an entry here is now a deliberate exception to a rule the whole
 * application keeps, and should be argued for in review.
 */

/** Still importing the 1,104-line legacy stylesheet. Deleted when this empties. */
export const LEGACY_STYLESHEET: readonly string[] = [];

/**
 * Building a table by hand.
 *
 * `inventory.css` styles those cells `text-align: left; white-space: nowrap`,
 * so money columns are ragged and the table cannot reflow — on a phone it is a
 * strip to be dragged sideways, and delivery riders read these on phones.
 * `DataTable` stacks each row into a labelled block instead.
 */
export const RAW_TABLE: readonly string[] = [];

/**
 * Hand-rolling a wait.
 *
 * Around twenty different phrasings of the same pause, none announced to a
 * screen reader, and a failure that offers no way to try again. `Resource`
 * renders all three states from one place.
 */
export const HAND_ROLLED_STATE: readonly string[] = [];

/**
 * Rendering no `PageHeader`, so no `data-test="page-<routeId>"`.
 *
 * `docs/TESTING.md` froze that contract and `PageHeader` emits it by
 * construction — but only three pages render one, so the browser specs fall
 * back to `getByRole` and are more brittle than the document describes.
 */
export const NO_PAGE_HEADER: readonly string[] = [];

/**
 * Not wired to the catalogue at all.
 *
 * **This is a wiring gate, not a completeness one**, and saying so matters: it
 * proves a page reads the catalogue, not that every string in it does. A regex
 * cannot tell a user-facing sentence from a `className`, and a gate that
 * pretends otherwise would be trusted for a guarantee it does not give. What it
 * does catch is the state the whole application is in today — 43 pages that
 * never call `t()` at all, behind a language switch that changes the frame and
 * nothing inside it.
 */
export const UNTRANSLATED: readonly string[] = [];

/**
 * Files still writing a class name that nothing can resolve.
 *
 * **Empty, and it starts empty**, which is unusual here and deliberate. The
 * thirty-seven orphaned names this gate was written for — `bell-panel`,
 * `chart-bar-group`, `metric-grid`, `timeline-summary` and the rest — were all
 * removed in the same change that added the rule, because every one of them was
 * a screen a user had already reported as broken. There was nothing to burn
 * down: there was a defect.
 *
 * The list exists so the thirty-eighth fails the build rather than joining a
 * silence. A class that resolves to nothing is not a CSS error; it is a page
 * that renders and looks wrong, and only to whoever opens it.
 *
 * Paths are relative to `src/`, e.g. `components/NotificationBell.tsx`, because
 * this rule spans `pages/`, `components/` and `app/` — and the fact that the
 * older rules cover only `pages/` is precisely how the four broken components
 * shipped.
 */
export const ORPHAN_CLASSES: readonly string[] = [];

/**
 * Shared primitives still writing an English sentence a reader would see.
 *
 * Empty, and it starts empty, for the same reason `ORPHAN_CLASSES` does: the
 * six sentences this gate was written for — "Something went wrong", "Try
 * again", "Quote this reference if you contact support", "Loading", "Nothing to
 * show yet", "This could not be loaded." — were all fixed in the change that
 * added the rule. Every one of them had a Bangla translation sitting unused in
 * `packages/i18n`, and `apps/mobile` was already reading it.
 *
 * The list exists so the seventh fails the build. Nothing else can see this
 * defect: a component that never asks the catalogue for a word produces no
 * missing key, no type error and no lint warning — only a language toggle that
 * quietly does not apply to the sentence a confused user has stopped to read.
 */
export const UNTRANSLATED_PRIMITIVES: readonly string[] = [];

/**
 * Files still writing a cache key as an array literal.
 *
 * Empty. Every one of the seventy-four query call sites now takes its key from
 * `lib/queryKeys.ts`, which is what makes "invalidate the whole family" a thing
 * anybody can write. Before that, the catalogue lived under five key shapes —
 * two of them fetching the identical URL into separate entries — and
 * `['delivery-personnel']` was written with two incompatible payload shapes
 * under one key, which crashed the round-planning form outright.
 */
export const RAW_QUERY_KEYS: readonly string[] = [];

/**
 * Files with a write that refreshes nothing and goes nowhere.
 *
 * Empty, and it starts empty. Twenty-three sites were in this state: nine that
 * refreshed nothing at all — approving an order left it in the queue you came
 * from — and fourteen that navigated to a list which then rendered the
 * pre-change row, two of them to the very list they had just edited.
 *
 * The rule this list guards is deliberately the weak one: that a mutation
 * invalidates *something*. No regex can know that a goods receipt also changes
 * the catalogue's availability. It catches the shape all twenty-three had — a
 * write with nothing after it — and the rest is review.
 */
export const UNINVALIDATED_MUTATIONS: readonly string[] = [];
