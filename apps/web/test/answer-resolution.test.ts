import { describe, expect, it } from 'vitest';

import {
  resolveCorrectOptionId,
  resolveCorrectOptionIndex,
} from '../src/review/answer-resolution';

describe('resolveCorrectOptionId', () => {
  it.each([
    [{ correctAnswerId: 'answer-a' }, 'answer-a'],
    [{ correct_answer_id: 'answer-b' }, 'answer-b'],
    [
      { correctAnswerId: 'canonical', correct_answer_id: 'wire' },
      'canonical',
    ],
    [{ correctAnswerId: '', correct_answer_id: 'fallback' }, 'fallback'],
    [{ correctAnswerId: '   ', correct_answer_id: 'fallback' }, 'fallback'],
  ] as const)('resolves %o', (detail, expected) => {
    expect(resolveCorrectOptionId(detail)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    'answer',
    2,
    [],
    {},
    { correctOptionId: 'obsolete-name' },
    { correctAnswerId: 7 },
    { correct_answer_id: false },
  ])('returns null for unsupported input %j', (detail) => {
    expect(resolveCorrectOptionId(detail)).toBeNull();
  });
});

describe('resolveCorrectOptionIndex', () => {
  const answers = [
    { id: 'camel-a' },
    { answer_id: 'wire-b' },
    { id: 'camel-c', answer_id: 'wire-c' },
  ];

  it.each([
    ['camel-a', 0],
    ['wire-b', 1],
    ['camel-c', 2],
    ['wire-c', -1],
    ['missing', -1],
    ['', -1],
    ['   ', -1],
    [null, -1],
    [undefined, -1],
  ] as const)('resolves %s to index %s', (correctId, expected) => {
    expect(resolveCorrectOptionIndex(answers, correctId)).toBe(expected);
  });

  it.each([
    [null, 'camel-a'],
    [undefined, 'camel-a'],
    [[], 'camel-a'],
  ] as const)('returns -1 for absent answers %j', (value, id) => {
    expect(resolveCorrectOptionIndex(value, id)).toBe(-1);
  });

  it('ignores empty and non-string answer identifiers', () => {
    expect(
      resolveCorrectOptionIndex(
        [{ id: '' }, { id: 4 }, { answer_id: false }, { answer_id: 'ok' }],
        'ok',
      ),
    ).toBe(3);
  });
});
