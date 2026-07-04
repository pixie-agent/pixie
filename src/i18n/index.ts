/**
 * 国际化/多语言模块
 * Internationalization (i18n) module
 * 多言語モジュール
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translation files
import zh from './locales/zh.json';
import en from './locales/en.json';
import ja from './locales/ja.json';

const resources = {
  zh: { translation: zh },
  en: { translation: en },
  ja: { translation: ja },
};

i18n
  .use(LanguageDetector) // Detect user language
  .use(initReactI18next) // Pass i18n instance to react-i18next
  .init({
    resources,
    fallbackLng: 'en', // Default language
    lng: 'en', // Default to English for this project
    debug: false,

    interpolation: {
      escapeValue: false, // React already escapes values
    },

    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;

// Language display names (native names)
export const LANGUAGE_NAMES: Record<string, string> = {
  zh: '简体中文',
  en: 'English',
  ja: '日本語',
};

// Supported languages list
export const SUPPORTED_LANGUAGES = [
  { code: 'zh', name: '简体中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
];
