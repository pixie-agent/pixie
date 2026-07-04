import { useTranslation as useI18next } from 'react-i18next';

/**
 * Hook to use translations in components
 * Provides type-safe translation keys
 */
export function useTranslation() {
  const { t, i18n } = useI18next();

  return {
    t,
    i18n,
    currentLanguage: i18n.language as 'zh' | 'en' | 'ja',
    changeLanguage: (lng: string) => i18n.changeLanguage(lng),
  };
}

export default useTranslation;
