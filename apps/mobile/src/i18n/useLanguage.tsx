import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import {
  catalogueFor,
  interpolate,
  isLanguage,
  resolveLanguage,
  type Catalogue,
  type Language,
} from '@medsupply/i18n';

/**
 * The resolved language, for the mobile application.
 *
 * `@medsupply/i18n` has been a declared dependency of this package since phase
 * 5 and was imported by **no file in it**. The web client got a language switch
 * and mobile got the dependency line — so a rider or a storekeeper who set the
 * product to Bangla on a desktop still got English in their hand, which is the
 * device most of them actually use.
 *
 * Deliberately the same shape and the same names as
 * `apps/web/src/lib/useLanguage.tsx`. Two differences are forced by the
 * platform and neither is a design choice:
 *
 *   - **Storage is asynchronous.** The web reads `localStorage` during the
 *     first render; `AsyncStorage` answers a tick later, so the chosen language
 *     applies on the second render rather than the first. Children are rendered
 *     immediately regardless — blocking on it would trade a brief flash for a
 *     blank screen, and `app/_layout.tsx` is already holding a splash for the
 *     session refresh over the same window.
 *   - **There is no `document`,** so nothing here sets a `lang` attribute. The
 *     platform reads the system language for its own announcements.
 */

const STORAGE_KEY = 'medsupply.language';

interface LanguageValue {
  language: Language;
  setLanguage: (next: Language) => void;
  /** The catalogue itself, for anything that reads a whole section. */
  c: Catalogue;
  /** `t('auth.signInTitle')`, with `{{name}}` interpolation. */
  t: (path: string, values?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageValue | null>(null);

function lookup(catalogue: Catalogue, path: string): string | undefined {
  const value = path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], catalogue);
  return typeof value === 'string' ? value : undefined;
}

/** The handset's own language, if the catalogue has it. */
function deviceLanguage(): string | undefined {
  try {
    return getLocales()[0]?.languageCode ?? undefined;
  } catch {
    // Never let a locale lookup stop the application from starting.
    return undefined;
  }
}

export function LanguageProvider({
  children,
  tenantDefault,
}: {
  children: ReactNode;
  tenantDefault?: string;
}) {
  const [chosen, setChosen] = useState<Language | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (!cancelled && isLanguage(value)) setChosen(value);
      })
      .catch(() => {
        // A device that cannot recall the choice still has to run.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const language = useMemo(
    () => resolveLanguage({ chosen, tenantDefault, device: deviceLanguage() }),
    [chosen, tenantDefault],
  );

  const setLanguage = useCallback((next: Language) => {
    // Applied now, remembered when the write lands. Failing to persist is no
    // reason to refuse the choice the person just made.
    setChosen(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const value = useMemo<LanguageValue>(() => {
    const catalogue = catalogueFor(language);
    return {
      language,
      setLanguage,
      c: catalogue,
      t: (path, values) => {
        const template = lookup(catalogue, path);
        // The key itself, if it is missing. Visible and obviously wrong beats
        // an empty string, which reads as a rendering bug rather than a gap.
        return template === undefined ? path : interpolate(template, values);
      },
    };
  }, [language, setLanguage]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/**
 * Falls back to English rather than throwing.
 *
 * A render test mounts one screen without the provider, and a screen that
 * merely shows a status should not need one. Same decision as the web client,
 * for the same reason.
 */
export function useLanguage(): LanguageValue {
  const context = useContext(LanguageContext);
  if (context) return context;
  const catalogue = catalogueFor('en');
  return {
    language: 'en',
    setLanguage: () => undefined,
    c: catalogue,
    t: (path, values) => interpolate(lookup(catalogue, path) ?? path, values),
  };
}
