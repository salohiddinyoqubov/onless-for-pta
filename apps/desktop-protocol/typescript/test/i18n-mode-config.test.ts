import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  EXAM_LIMITS,
  EXAM_MODES,
  LOCALES,
  MODE_CONFIGS,
  TRANSLATION_KEYS,
  UnsupportedExamModeError,
  UnsupportedLocaleError,
  formatDuration,
  formatExamSummary,
  formatQuestionCount,
  getModeConfig,
  isExamMode,
  isIntegerInRange,
  isLocale,
  modeLabel,
  parseExamMode,
  parseLocale,
  ruPlural,
  russianPluralCategory,
  translate,
  validateModeBounds,
  type ExamMode,
  type SessionStatus,
} from '../src/index.js';

const fixtureSchema = z
  .object({
    pluralCases: z.array(
      z.object({
        value: z.number(),
        category: z.enum(['one', 'few', 'many']),
        questions: z.string(),
        minutes: z.string(),
      }),
    ),
    summaryCases: z.array(
      z.object({
        locale: z.enum(LOCALES),
        questions: z.number(),
        minutes: z.number(),
        expected: z.string(),
      }),
    ),
  })
  .loose();

function readFixture(): z.infer<typeof fixtureSchema> {
  const path = new URL('../../fixtures/exam-modes.json', import.meta.url);
  return fixtureSchema.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

describe('mode configuration', () => {
  it('has one exhaustive configuration for every public mode', () => {
    expect(Object.keys(MODE_CONFIGS).sort()).toEqual([...EXAM_MODES].sort());
    for (const mode of EXAM_MODES) {
      expect(getModeConfig(mode).mode).toBe(mode);
    }
  });

  it('keeps every default inside its declared range', () => {
    for (const config of Object.values(MODE_CONFIGS)) {
      expect(isIntegerInRange(config.questions.default, config.questions)).toBe(true);
      expect(isIntegerInRange(config.durationMinutes.default, config.durationMinutes)).toBe(true);
      expect(config.questions.min).toBeGreaterThanOrEqual(EXAM_LIMITS.questionCount.min);
      expect(config.questions.max).toBeLessThanOrEqual(EXAM_LIMITS.questionCount.max);
      expect(config.durationMinutes.min).toBeGreaterThanOrEqual(
        EXAM_LIMITS.durationMinutes.min,
      );
      expect(config.durationMinutes.max).toBeLessThanOrEqual(
        EXAM_LIMITS.durationMinutes.max,
      );
    }
  });

  it('keeps the published standard exam contract fixed at 20 questions and 25 minutes', () => {
    expect(MODE_CONFIGS.exam.questions).toEqual({ min: 20, max: 20, default: 20 });
    expect(MODE_CONFIGS.exam.durationMinutes).toEqual({ min: 25, max: 25, default: 25 });
    expect(validateModeBounds('exam', 20, 25)).toEqual([]);
    expect(validateModeBounds('exam', 19, 25)).toHaveLength(1);
    expect(validateModeBounds('exam', 20, 26)).toHaveLength(1);
  });

  it('reports both numeric violations without short-circuiting', () => {
    expect(validateModeBounds('training', 0, 181)).toEqual([
      'questionCount must be an integer from 1 to 100 for training',
      'durationMinutes must be an integer from 1 to 180 for training',
    ]);
    expect(validateModeBounds('training', 1.5, 25.5)).toHaveLength(2);
  });

  it('rejects unsupported values without falling back to training', () => {
    for (const value of ['practice', '', 'EXAM', null, 1, {}, []]) {
      expect(isExamMode(value)).toBe(false);
      expect(() => parseExamMode(value)).toThrow(UnsupportedExamModeError);
      expect(() => getModeConfig(value)).toThrow(UnsupportedExamModeError);
    }
  });
});

describe('locale and translation boundaries', () => {
  const modes: readonly ExamMode[] = EXAM_MODES;
  const statuses: readonly SessionStatus[] = [
    'draft',
    'active',
    'paused',
    'completed',
    'cancelled',
  ];

  it('requires an explicit supported locale', () => {
    for (const locale of LOCALES) {
      expect(isLocale(locale)).toBe(true);
      expect(parseLocale(locale)).toBe(locale);
    }
    for (const value of ['en', 'UZ', '', null, undefined, 2]) {
      expect(isLocale(value)).toBe(false);
      expect(() => parseLocale(value)).toThrow(UnsupportedLocaleError);
    }
  });

  it('provides a non-empty mode label for every locale and mode', () => {
    for (const locale of LOCALES) {
      for (const mode of modes) {
        expect(modeLabel(locale, mode).trim()).not.toBe('');
      }
    }
  });

  it('provides a non-empty status label for every locale and status', () => {
    for (const locale of LOCALES) {
      for (const status of statuses) {
        expect(translate(locale, `exam.status.${status}`).trim()).not.toBe('');
      }
    }
  });

  it('keeps the translation-key contract complete in both locales', () => {
    for (const locale of LOCALES) {
      for (const key of TRANSLATION_KEYS) {
        if (key === 'exam.summary') {
          expect(translate(locale, key, { questions: 'Q', minutes: 'M' })).toBe('Q, M');
        } else {
          expect(translate(locale, key)).not.toBe(key);
        }
      }
    }
  });

  it('rejects missing interpolation parameters', () => {
    expect(() => translate('uz', 'exam.summary')).toThrow(/questions/);
    expect(() => translate('ru', 'exam.summary', { questions: '20 вопросов' })).toThrow(
      /minutes/,
    );
  });
});

describe('pluralization and human-readable summaries', () => {
  const fixture = readFixture();

  it('matches every shared Russian plural fixture', () => {
    for (const testCase of fixture.pluralCases) {
      expect(russianPluralCategory(testCase.value)).toBe(testCase.category);
      expect(formatQuestionCount('ru', testCase.value)).toBe(testCase.questions);
      expect(formatDuration('ru', testCase.value)).toBe(testCase.minutes);
    }
  });

  it('handles negative Russian plural inputs defensively', () => {
    expect(russianPluralCategory(-1)).toBe('one');
    expect(russianPluralCategory(-2)).toBe('few');
    expect(russianPluralCategory(-11)).toBe('many');
    expect(ruPlural(-21, 'one', 'few', 'many')).toBe('one');
  });

  it('normalizes fractional plural inputs but rejects non-finite values', () => {
    expect(russianPluralCategory(2.9)).toBe('few');
    expect(() => russianPluralCategory(Number.NaN)).toThrow(RangeError);
    expect(() => russianPluralCategory(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('uses invariant Uzbek nouns', () => {
    for (const value of [0, 1, 2, 5, 11, 21, 100]) {
      expect(formatQuestionCount('uz', value)).toBe(`${String(value)} ta savol`);
      expect(formatDuration('uz', value)).toBe(`${String(value)} daqiqa`);
    }
  });

  it('matches shared localized summary fixtures', () => {
    for (const testCase of fixture.summaryCases) {
      expect(
        formatExamSummary(testCase.locale, testCase.questions, testCase.minutes),
      ).toBe(testCase.expected);
    }
  });

  it('rejects invalid public formatter inputs', () => {
    const invalid = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1];
    for (const value of invalid) {
      for (const locale of LOCALES) {
        expect(() => formatQuestionCount(locale, value)).toThrow(RangeError);
        expect(() => formatDuration(locale, value)).toThrow(RangeError);
      }
    }
  });
});
