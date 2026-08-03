import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  catalogueFor,
  interpolate,
  isLanguage,
  resolveLanguage,
  type Catalogue,
  type Language,
} from '@medsupply/i18n';

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

function storedLanguage(): Language | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLanguage(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The resolved language, for the whole application.
 *
 * `SystemSettings.tsx` has declared `LOCALE_OPTIONS = ['en', 'bn']` since phase
 * 10 and `LocalisationSettings` has existed in the shared types for as long.
 * Nothing read either, and there was no Bangla anywhere in a product operated
 * in Bangladesh.
 */
export function LanguageProvider({
  children,
  tenantDefault,
}: {
  children: ReactNode;
  tenantDefault?: string;
}) {
  const [chosen, setChosen] = useState<Language | undefined>(() => storedLanguage());

  const language = useMemo(
    () =>
      resolveLanguage({
        chosen,
        tenantDefault,
        device: typeof navigator === 'undefined' ? undefined : navigator.language,
      }),
    [chosen, tenantDefault],
  );

  // `<html lang>` so a screen reader announces the page in the right voice —
  // Bangla read aloud by an English speech engine is not comprehensible.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not being able to remember the choice is no reason to refuse it now.
    }
    setChosen(next);
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
 * Component tests mount one leaf page without the provider, and a page that
 * merely shows a status should not need one. Anything that actually depends on
 * a chosen language renders in English there, which is what those tests assert
 * anyway.
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
