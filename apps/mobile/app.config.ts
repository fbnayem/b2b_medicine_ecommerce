import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Three applications, built from this one project.
 *
 * `APP_VARIANT` picks which. Everything that makes an installed application a
 * separate thing — its name, its icon, its bundle identifier, its URL scheme,
 * the permissions it asks the operating system for — is decided here and
 * nowhere else, so the three cannot drift into each other.
 *
 * ## Why this file replaced `app.json`
 *
 * There was one static `app.json` describing one application called "MedSupply
 * B2B". Four of its fields now differ per application and a fifth is computed,
 * so keeping a static base alongside a dynamic override would mean two files
 * that both look authoritative and one that silently loses. Expo reads
 * `app.config.ts` alone perfectly well; this is the whole configuration.
 *
 * ## Why nothing here imports `@medsupply/navigation`
 *
 * It would be the obvious thing: `VARIANT_ROLES` already names the three
 * applications, and duplication is what this repository spends its tests
 * preventing. But Expo evaluates this file **before anything is built** — on a
 * clean EAS worker, right after `pnpm install`, when no workspace package has a
 * `dist/` yet. An import of `@medsupply/navigation` resolves to
 * `dist/index.js`, which would not exist, and the build would fail at
 * configuration time with an error about a missing module rather than anything
 * to do with medicine.
 *
 * So the three names are written out again, and `src/appVariant.test.ts`
 * asserts this file and the navigation package agree. That is the same trade
 * `TAB_ROUTE_FILE` makes next door: repeat the short thing, and gate it.
 *
 * ## One EAS project, three applications
 *
 * `slug` stays constant, which is what makes these three variants of one EAS
 * project rather than three projects — the arrangement Expo's own multiple-app-
 * variants guide describes. Credentials are keyed by bundle identifier, so one
 * project holds all three sets, and there is one `eas init` to run rather than
 * three accounts' worth of bookkeeping.
 *
 * `extra.eas.projectId` and `owner` come from the environment because they are
 * account-specific and this repository has never been linked to an Expo
 * account. `docs/MOBILE_BUILDS.md` gives the exact commands and where to paste
 * the id. An absent one fails with a message that says so; a guessed one would
 * build under somebody else's account.
 */

type VariantName = 'shop' | 'staff' | 'rider';

const VARIANTS: readonly VariantName[] = ['shop', 'staff', 'rider'];

interface AppIdentity {
  /** What a person reads under the icon, and in the store listing. */
  name: string;
  /** `medsupplyrider://` — one per application, or a deep link opens whichever installed first. */
  scheme: string;
  /** Reverse-DNS, identical on both platforms so there is one thing to remember. */
  bundleId: string;
  /**
   * The adaptive icon's background.
   *
   * Taken from `chartLight` in `@medsupply/design-tokens`, whose six colours
   * were chosen to stay distinguishable in the common forms of colour blindness
   * **and in greyscale**. Three icons that share a foreground have to be told
   * apart by this one field, often at 48px on a cracked screen in daylight, so
   * borrowing a palette already proven to separate is better than picking three
   * greens that look distinct on a monitor.
   */
  accent: string;
  /**
   * Why this application wants a camera, in the words of the prompt itself, or
   * `null` if it does not want one.
   *
   * Each application declares only what its own screens use. A pharmacy
   * owner's asks for **no camera and no location**, because nothing in it uses
   * either — the shop screens are catalogue, cart, orders and statements. One
   * application for everybody meant every pharmacy owner installed something
   * that declared it wanted their location, and there was no honest sentence to
   * put in the prompt.
   *
   * Written out per application rather than derived from a boolean, because a
   * permission prompt is read by somebody deciding whether to trust us, and
   * "scan barcodes while picking" and "photograph proof of delivery" are not
   * interchangeable sentences.
   */
  cameraReason: string | null;
  /** Same, for foreground location. */
  locationReason: string | null;
}

const IDENTITIES: Record<VariantName, AppIdentity> = {
  shop: {
    name: 'MedSupply Shop',
    scheme: 'medsupplyshop',
    bundleId: 'com.medsupply.shop',
    accent: '#126b45',
    cameraReason: null,
    locationReason: null,
  },
  staff: {
    name: 'MedSupply Manage',
    scheme: 'medsupplymanage',
    bundleId: 'com.medsupply.manage',
    accent: '#1f5fa8',
    cameraReason: 'Allow MedSupply Manage to scan barcodes while picking and packing an order.',
    locationReason: null,
  },
  rider: {
    name: 'MedSupply Rider',
    scheme: 'medsupplyrider',
    bundleId: 'com.medsupply.rider',
    accent: '#8a5300',
    cameraReason: 'Allow MedSupply Rider to photograph proof of delivery and payment.',
    locationReason:
      'Allow MedSupply Rider to record where a delivery was confirmed. It is read only at the moment you confirm one.',
  },
};

/**
 * Which application is being configured.
 *
 * Absent means the staff application, so `pnpm start` with no arguments does
 * something rather than failing — that is the build a developer wants nine
 * times in ten, and `pnpm start:shop` / `start:rider` are one word away.
 *
 * A **misspelt** value throws. Defaulting on a typo is how somebody submits
 * "MedSupply Manage" to a store listing that says it is for delivery riders.
 */
export function resolveVariant(raw: string | undefined): VariantName {
  if (raw === undefined || raw === '') return 'staff';
  if (!(VARIANTS as readonly string[]).includes(raw)) {
    throw new Error(
      `APP_VARIANT="${raw}" is not one of ${VARIANTS.join(', ')}. ` +
        'Use pnpm start:shop, start:staff or start:rider, or an eas.json profile.',
    );
  }
  return raw as VariantName;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = resolveVariant(process.env.APP_VARIANT);
  const identity = IDENTITIES[variant];

  return {
    ...config,
    name: identity.name,
    // Constant: the three applications are one EAS project, told apart by
    // bundle identifier. See the note at the top of this file.
    slug: 'medsupply-b2b',
    scheme: identity.scheme,
    version: '1.0.0',
    orientation: 'portrait',
    /*
     * One icon per application, not one icon with three background colours.
     *
     * All three shipped with the Expo template's mark, told apart only by
     * `accent` below — and an operator can have two of these installed at once.
     * Picking the wrong one on a home screen means taking an order in the
     * rider's application. Each now has a **different silhouette** — a carton,
     * a clipboard, a pin — because that is what survives 48 pixels, greyscale,
     * colour blindness, and Android's monochrome themed-icon treatment, none of
     * which a background colour survives. `scripts/icons.mjs` draws them.
     */
    icon: `./assets/icon-${variant}.png`,
    /*
     * Pinned, and this is the file `theme.ts` refers to when it says the
     * palette is light only. Every screen is written against `semanticLight`,
     * so a handset in dark mode must not be given dark system chrome around
     * light content.
     */
    userInterfaceStyle: 'light',
    owner: process.env.EAS_OWNER,
    ios: {
      supportsTablet: true,
      bundleIdentifier: identity.bundleId,
    },
    android: {
      package: identity.bundleId,
      adaptiveIcon: {
        backgroundColor: identity.accent,
        foregroundImage: `./assets/android-icon-foreground-${variant}.png`,
        backgroundImage: `./assets/android-icon-background-${variant}.png`,
        monochromeImage: `./assets/android-icon-monochrome-${variant}.png`,
      },
      /*
       * Left off. The predictive back gesture animates away from a screen
       * before the application has agreed to leave it, and several screens here
       * hold unsaved work — a part-captured proof of delivery, a half-counted
       * stocktake line. Turning it on is a separate piece of work about
       * confirming before discarding, not a flag.
       */
      predictiveBackGestureEnabled: false,
      /**
       * Permissions this build does **not** want, struck out by name.
       *
       * Omitting a config plugin removes the *prompt* and nothing else. Every
       * variant is built from one `package.json`, so `expo-camera` and
       * `expo-location` are autolinked into all three, and Android's manifest
       * merger folds each library's own `<uses-permission>` into the app's.
       *
       * The result went unnoticed for four phases because nothing ever ran a
       * prebuild: **MedSupply Shop declared CAMERA, ACCESS_FINE_LOCATION and
       * ACCESS_COARSE_LOCATION** — the three things Phase 36 says out loud it
       * asks for none of, and that `docs/STORE_LISTINGS.md` declares it does
       * not collect. A pharmacy owner installing it would have been shown a
       * location permission on the store page for an application whose screens
       * are a catalogue, a basket and a statement.
       *
       * `blockedPermissions` emits `tools:node="remove"`, which is the only
       * thing that undoes a merge. Derived from the same two reason strings, so
       * a variant that gains a camera gains the permission with it and cannot
       * drift.
       */
      blockedPermissions: [
        ...(identity.cameraReason ? [] : ['android.permission.CAMERA']),
        ...(identity.locationReason
          ? []
          : [
              'android.permission.ACCESS_FINE_LOCATION',
              'android.permission.ACCESS_COARSE_LOCATION',
            ]),
      ],
    },
    web: { favicon: './assets/favicon.png' },
    plugins: [
      'expo-secure-store',
      ...(identity.cameraReason
        ? [
            [
              'expo-camera',
              { cameraPermission: identity.cameraReason, recordAudioAndroid: false },
            ] as const,
          ]
        : []),
      ...(identity.locationReason
        ? [['expo-location', { locationWhenInUsePermission: identity.locationReason }] as const]
        : []),
      'expo-router',
      ['expo-notifications', { color: identity.accent, defaultChannel: 'medsupply-operations' }],
      'expo-status-bar',
      'expo-localization',
    ] as ExpoConfig['plugins'],
    extra: {
      ...config.extra,
      /** Read at run time by `src/appVariant.ts` to decide who may sign in. */
      variant,
      eas: { projectId: process.env.EAS_PROJECT_ID },
    },
  };
};
