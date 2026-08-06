import { describe, expect, it, vi } from 'vitest';
import { APP_VARIANTS, VARIANT_ROLES, type AppVariant } from '@medsupply/navigation';
import { UserRole } from '@medsupply/shared-types';
import { translatorFor } from '@medsupply/i18n';

/*
 * The run-time half reads `Constants.expoConfig.extra.variant`, which only a
 * real build has. Mocked to the rider application, because that is the one
 * whose refusals matter most: a manager who installs it is the case the
 * message below has to handle well.
 */
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { variant: 'rider' } } },
}));

/**
 * Three applications are built from this one project, and almost everything
 * that keeps them three lives in files no test would otherwise open:
 * `app.config.ts`, which Expo evaluates, and `eas.json`, which EAS reads.
 *
 * The failures those two can produce are the expensive kind — they surface at
 * the end of a twenty-minute cloud build, or after a store review, or on a
 * rider's handset a week later. So they are asserted here, on a workstation,
 * in a second.
 *
 * `app.config.ts` deliberately repeats the three variant names rather than
 * importing `@medsupply/navigation`, because Expo evaluates it before any
 * workspace package has been built. The first test below is the other half of
 * that trade.
 */

import * as config from '../app.config';
import { APP_VARIANT, ALLOWED_ROLES, mayUseThisApp, wrongAppMessage } from './appVariant';

/** Every file under `app/`, read through Vite rather than `node:fs`. */
const SCREENS = import.meta.glob('../app/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const EAS = import.meta.glob('../eas.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * The launcher icons, as data URIs.
 *
 * `?inline` rather than `?raw`, because these are PNGs: read as text the header
 * is mangled by the text decoder before anything can check it, and every file
 * would look equally valid and equally broken. Base64 survives intact, and
 * `node:fs` stays out of a directory whose code ships to Hermes.
 */
const ASSETS = import.meta.glob('../assets/*.png', {
  query: '?inline',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const easJson = JSON.parse(Object.values(EAS)[0]!) as {
  cli: Record<string, unknown>;
  build: Record<string, { extends?: string; env?: Record<string, string>; distribution?: string }>;
};

function configFor(variant: AppVariant) {
  process.env.APP_VARIANT = variant;
  return config.default({ config: { name: '', slug: '' } } as never);
}

describe('the three applications', () => {
  it('found the files to read, so a clean run is not an empty one', () => {
    expect(Object.keys(SCREENS).length).toBeGreaterThan(30);
    expect(Object.keys(easJson.build).length).toBeGreaterThan(3);
  });

  it('are the same three the navigation package names', () => {
    /*
     * The gate that makes `app.config.ts`'s duplication safe. A fourth
     * application added to `VARIANT_ROLES` and forgotten here would be a role
     * whose people have nothing to install, and nothing else would say so.
     */
    const inConfig = APP_VARIANTS.map((variant) => variant).sort();
    for (const variant of inConfig) {
      expect(() => configFor(variant), `${variant} has no identity`).not.toThrow();
    }
    expect(config.resolveVariant('shop')).toBe('shop');
  });

  it('refuse a misspelt variant rather than quietly building the wrong one', () => {
    expect(() => config.resolveVariant('reider')).toThrow(/not one of/);
    expect(() => config.resolveVariant('SHOP')).toThrow(/not one of/);
    // Absent is the staff application, so `pnpm start` does something.
    expect(config.resolveVariant(undefined)).toBe('staff');
    expect(config.resolveVariant('')).toBe('staff');
  });

  it('can be installed side by side, because nothing that identifies them collides', () => {
    const names = new Set<string>();
    const schemes = new Set<string>();
    const bundles = new Set<string>();

    for (const variant of APP_VARIANTS) {
      const built = configFor(variant);
      names.add(built.name);
      schemes.add(built.scheme as string);
      bundles.add(built.ios!.bundleIdentifier!);
      // Same identifier on both platforms: one thing to remember, not two.
      expect(built.android!.package).toBe(built.ios!.bundleIdentifier);
      // A shared slug is what makes these one EAS project rather than three.
      expect(built.slug).toBe('medsupply-b2b');
    }

    expect(names.size, 'two applications share a name').toBe(APP_VARIANTS.length);
    expect(schemes.size, 'two applications answer the same deep link').toBe(APP_VARIANTS.length);
    expect(bundles.size, 'two applications would overwrite each other').toBe(APP_VARIANTS.length);
  });

  it('use identifiers and schemes the stores will accept', () => {
    for (const variant of APP_VARIANTS) {
      const built = configFor(variant);
      // Reverse DNS, at least three parts, lower case — Play rejects the rest.
      expect(built.android!.package, variant).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/);
      // The scheme pattern from the Expo config schema.
      expect(built.scheme as string, variant).toMatch(/^[a-z][a-z0-9+.-]*$/);
      expect(built.version, variant).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('tell somebody which application they are looking at', () => {
    // The sign-in screen renders this, and a build whose name is missing shows
    // an empty heading rather than an obvious fault.
    for (const variant of APP_VARIANTS) {
      expect(configFor(variant).name.length, variant).toBeGreaterThan(3);
    }
  });

  it('carry the variant into the built application, so it can be read at run time', () => {
    for (const variant of APP_VARIANTS) {
      expect(configFor(variant).extra?.variant).toBe(variant);
    }
  });
});

describe('what each application asks the operating system for', () => {
  /**
   * The two screens that use a native capability, and which application each
   * belongs to.
   *
   * Asserted against the source below, so a third screen reaching for a camera
   * fails here and somebody has to decide which of the three applications is
   * allowed to ask for one — rather than all three asking because they always
   * did.
   */
  const NATIVE_USERS: Record<string, { variant: AppVariant; modules: string[] }> = {
    'delivery-proof': { variant: 'rider', modules: ['expo-camera', 'expo-location'] },
    picking: { variant: 'staff', modules: ['expo-camera'] },
  };

  const pluginNames = (variant: AppVariant): string[] =>
    (configFor(variant).plugins ?? []).map((entry) =>
      typeof entry === 'string' ? entry : (entry as [string])[0],
    );

  it('is the list of screens that actually use one', () => {
    const found: Record<string, string[]> = {};
    for (const [path, source] of Object.entries(SCREENS)) {
      if (path.includes('.test.')) continue;
      const screen = path
        .split('/')
        .pop()!
        .replace(/\.tsx$/, '');
      const modules = ['expo-camera', 'expo-location'].filter((module) =>
        source.includes(`from '${module}'`),
      );
      if (modules.length) found[screen] = modules;
    }

    expect(
      found,
      'A screen started or stopped using a native capability. Update NATIVE_USERS, and check ' +
        'that the application it belongs to still declares the right permissions.',
    ).toEqual(
      Object.fromEntries(
        Object.entries(NATIVE_USERS).map(([screen, entry]) => [screen, entry.modules]),
      ),
    );
  });

  it('is declared by the application that needs it', () => {
    for (const [screen, entry] of Object.entries(NATIVE_USERS)) {
      const declared = pluginNames(entry.variant);
      for (const module of entry.modules) {
        expect(
          declared,
          `${entry.variant} hosts ${screen} but does not declare ${module}`,
        ).toContain(module);
      }
    }
  });

  it('is not declared by an application that has no use for it', () => {
    /*
     * The decision this file exists to hold. A pharmacy owner's application
     * asks for **no camera and no location**: nothing in the shop screens uses
     * either, and there was no honest sentence to put in a permission prompt
     * when one binary served everybody.
     */
    const shop = pluginNames('shop');
    expect(shop).not.toContain('expo-camera');
    expect(shop).not.toContain('expo-location');
    // A manager scans barcodes; a manager does not need to be located.
    expect(pluginNames('staff')).not.toContain('expo-location');
  });

  it('always declares what every application needs', () => {
    for (const variant of APP_VARIANTS) {
      const declared = pluginNames(variant);
      // Tokens are never in insecure storage, on any of the three.
      expect(declared, variant).toContain('expo-secure-store');
      expect(declared, variant).toContain('expo-router');
      expect(declared, variant).toContain('expo-localization');
      expect(declared, variant).toContain('expo-notifications');
    }
  });

  /**
   * **Three icons, and they are actually there.**
   *
   * All three shipped with the Expo template's mark and were told apart by a
   * background colour, which is no help at all: an operator with two of these
   * installed picks by silhouette on a home screen, and picking wrong means
   * taking an order in the rider's application.
   *
   * The failure this guards is worse than a missing file — Expo resolves icon
   * paths at build time, so a name that does not exist fails a cloud build
   * twenty minutes in, or worse, silently falls back. Reading the actual PNG
   * headers rather than only checking existence, because a zero-byte or
   * truncated file is exactly what a half-finished generator leaves behind.
   */
  it('gives every application its own icon, and every icon is a real image', () => {
    const byPath = new Map(
      Object.entries(ASSETS).map(([path, data]) => [path.replace('../assets/', ''), data]),
    );

    /** Width and height, straight out of the PNG's IHDR chunk. */
    function header(name: string) {
      const uri = byPath.get(name);
      expect(uri, `assets/${name} does not exist, and app.config.ts names it`).toBeDefined();
      const bytes = Buffer.from(uri!.slice(uri!.indexOf(',') + 1), 'base64');
      expect(bytes.subarray(1, 4).toString('ascii'), `assets/${name} is not a PNG`).toBe('PNG');
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }

    const seen = new Set<string>();
    for (const variant of APP_VARIANTS) {
      const built = configFor(variant);
      const icon = (built.icon as string).replace('./assets/', '');
      expect(icon, `${variant} shares an icon with another application`).not.toBe('icon.png');
      expect(seen.has(icon), `${variant} reuses ${icon}`).toBe(false);
      seen.add(icon);

      // 1024 square is what both stores take, and neither accepts a smaller
      // one — this is the size that gets uploaded rather than resized.
      expect(header(icon), variant).toEqual({ width: 1024, height: 1024 });

      const adaptive = built.android?.adaptiveIcon as Record<string, string>;
      for (const layer of ['foregroundImage', 'backgroundImage', 'monochromeImage']) {
        const file = adaptive[layer]!.replace('./assets/', '');
        expect(file, `${variant} ${layer}`).toContain(variant);
        const { width, height } = header(file);
        expect(width, `${variant} ${layer}`).toBe(height);
      }
      expect(adaptive.backgroundColor).toMatch(/^#[0-9a-f]{6}$/i);
    }

    expect(seen.size).toBe(APP_VARIANTS.length);
  });

  it('writes a permission prompt that names the application asking', () => {
    // "Allow MedSupply B2B to…" on a phone showing an icon called MedSupply
    // Rider is the prompt people decline.
    for (const variant of APP_VARIANTS) {
      const built = configFor(variant);
      for (const plugin of built.plugins ?? []) {
        if (typeof plugin === 'string') continue;
        const [, options] = plugin as [string, Record<string, string>];
        for (const message of Object.values(options ?? {})) {
          if (typeof message !== 'string' || !message.startsWith('Allow')) continue;
          expect(message, `${variant}: ${message}`).toContain(built.name);
        }
      }
    }
  });
});

describe('eas.json', () => {
  it('has a build profile for every application at every stage', () => {
    for (const stage of ['development', 'preview', 'production']) {
      for (const variant of APP_VARIANTS) {
        const profile = easJson.build[`${stage}-${variant}`];
        expect(profile, `${stage}-${variant} is missing`).toBeDefined();
        expect(profile!.env?.APP_VARIANT, `${stage}-${variant} builds the wrong app`).toBe(variant);
      }
    }
  });

  it('never builds a profile whose name and variant disagree', () => {
    /*
     * A copy-paste between nine near-identical blocks is the obvious way for
     * this file to go wrong, and the result is `eas build --profile
     * production-rider` shipping the shop application to the riders' track.
     */
    for (const [name, profile] of Object.entries(easJson.build)) {
      const declared = profile.env?.APP_VARIANT;
      if (!declared) continue;
      expect(name.endsWith(`-${declared}`), `${name} sets APP_VARIANT=${declared}`).toBe(true);
    }
  });

  it('sends nothing to a store by accident', () => {
    for (const [name, profile] of Object.entries(easJson.build)) {
      if (profile.distribution !== 'store') continue;
      expect(name.startsWith('production-'), `${name} is a store build`).toBe(true);
    }
  });

  it('points every build at an API, and never at a developer workstation in production', () => {
    for (const [name, profile] of Object.entries(easJson.build)) {
      if (!name.startsWith('production-')) continue;
      const url = profile.env?.EXPO_PUBLIC_API_URL ?? '';
      expect(url, `${name} has no API address`).not.toBe('');
      expect(url.startsWith('https://'), `${name} would send tokens in clear`).toBe(true);
      expect(/localhost|10\.0\.2\.2|127\.0\.0\.1/.test(url), `${name} points at a laptop`).toBe(
        false,
      );
    }
  });
});

describe('who a running application lets in', () => {
  const t = translatorFor('en');

  it('reads the variant its build was configured with', () => {
    expect(APP_VARIANT).toBe('rider');
    expect(ALLOWED_ROLES).toEqual(VARIANT_ROLES.rider);
  });

  it('admits the role this application was built for', () => {
    expect(mayUseThisApp(UserRole.DELIVERY_PERSON)).toBe(true);
    expect(wrongAppMessage(UserRole.DELIVERY_PERSON, t)).toBeUndefined();
  });

  it('turns everybody else away', () => {
    for (const role of Object.values(UserRole)) {
      if (role === UserRole.DELIVERY_PERSON) continue;
      expect(mayUseThisApp(role), role).toBe(false);
      expect(wrongAppMessage(role, t), role).toBeTruthy();
    }
  });

  it('names the application they should install instead, rather than refusing them', () => {
    /*
     * The whole point of the message. "You do not have permission" would be
     * false — the account is fine — and would send somebody to their manager
     * about an access problem that does not exist. What they need is the name
     * of the icon to look for.
     */
    const manager = wrongAppMessage(UserRole.MANAGER, t)!;
    expect(manager).toContain('MedSupply Manage');
    expect(manager).toContain('MedSupply Rider');
    expect(manager.toLowerCase()).not.toContain('permission');

    const owner = wrongAppMessage(UserRole.SHOP_OWNER, t)!;
    expect(owner).toContain('MedSupply Shop');

    // And it is a sentence, not a dotted catalogue path.
    expect(manager).not.toMatch(/^auth\./);
  });
});
