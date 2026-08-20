import type { ExamMode } from './mode-config.js';
import { ruPlural } from './plural.js';

export const LOCALES = ['uz', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];

export const TRANSLATION_KEYS = [
  'exam.mode.exam',
  'exam.mode.training',
  'exam.mode.category',
  'exam.mode.ticket',
  'exam.mode.grand_mock',
  'exam.status.draft',
  'exam.status.active',
  'exam.status.paused',
  'exam.status.completed',
  'exam.status.cancelled',
  'exam.summary',
] as const;

export type TranslationKey = (typeof TRANSLATION_KEYS)[number];

const translations: Readonly<Record<Locale, Readonly<Record<TranslationKey, string>>>> = {
  uz: {
    'exam.mode.exam': 'Imtihon',
    'exam.mode.training': 'Mashq',
    'exam.mode.category': 'Kategoriya',
    'exam.mode.ticket': 'Bilet',
    'exam.mode.grand_mock': 'Katta sinov',
    'exam.status.draft': 'Tayyorlanmoqda',
    'exam.status.active': 'Davom etmoqda',
    'exam.status.paused': 'To‘xtatilgan',
    'exam.status.completed': 'Yakunlangan',
    'exam.status.cancelled': 'Bekor qilingan',
    'exam.summary': '{questions}, {minutes}',
  },
  ru: {
    'exam.mode.exam': 'Экзамен',
    'exam.mode.training': 'Тренировка',
    'exam.mode.category': 'Категория',
    'exam.mode.ticket': 'Билет',
    'exam.mode.grand_mock': 'Большая проверка',
    'exam.status.draft': 'Подготовка',
    'exam.status.active': 'В процессе',
    'exam.status.paused': 'Приостановлено',
    'exam.status.completed': 'Завершено',
    'exam.status.cancelled': 'Отменено',
    'exam.summary': '{questions}, {minutes}',
  },
};

export class UnsupportedLocaleError extends Error {
  public readonly value: unknown;

  public constructor(value: unknown) {
    super(`Unsupported locale: ${String(value)}`);
    this.name = 'UnsupportedLocaleError';
    this.value = value;
  }
}

export class TranslationParameterError extends Error {
  public constructor(key: TranslationKey, parameter: string) {
    super(`Missing translation parameter "${parameter}" for "${key}"`);
    this.name = 'TranslationParameterError';
  }
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && LOCALES.some((locale) => locale === value);
}

export function parseLocale(value: unknown): Locale {
  if (!isLocale(value)) {
    throw new UnsupportedLocaleError(value);
  }
  return value;
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  parameters: Readonly<Record<string, string | number>> = {},
): string {
  return translations[locale][key].replaceAll(/\{([^{}]+)\}/g, (_match, name: string) => {
    const replacement = parameters[name];
    if (replacement === undefined) {
      throw new TranslationParameterError(key, name);
    }
    return String(replacement);
  });
}

export function modeLabel(locale: Locale, mode: ExamMode): string {
  return translate(locale, `exam.mode.${mode}`);
}

export function formatQuestionCount(locale: Locale, count: number): string {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError('Question count must be a non-negative safe integer');
  }

  if (locale === 'uz') {
    return `${String(count)} ta savol`;
  }

  return `${String(count)} ${ruPlural(count, 'вопрос', 'вопроса', 'вопросов')}`;
}

export function formatDuration(locale: Locale, minutes: number): string {
  if (!Number.isSafeInteger(minutes) || minutes < 0) {
    throw new RangeError('Duration must be a non-negative safe integer');
  }

  if (locale === 'uz') {
    return `${String(minutes)} daqiqa`;
  }

  return `${String(minutes)} ${ruPlural(minutes, 'минута', 'минуты', 'минут')}`;
}

export function formatExamSummary(
  locale: Locale,
  questionCount: number,
  durationMinutes: number,
): string {
  return translate(locale, 'exam.summary', {
    questions: formatQuestionCount(locale, questionCount),
    minutes: formatDuration(locale, durationMinutes),
  });
}
