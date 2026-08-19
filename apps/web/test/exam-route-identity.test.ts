import { describe, expect, it } from 'vitest';

import {
  buildNonBattleExamRouteIdentity,
  hasInvalidRetrySessionId,
  readAliasedSearchParam,
} from '../src/exam/route-identity';

function params(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values);
}

describe('buildNonBattleExamRouteIdentity', () => {
  it.each([
    ['mode', 'training'],
    ['launch_type', 'ticket'],
    ['intent', 'force_new'],
    ['entry_surface', 'practice'],
    ['ticket_number', '7'],
    ['category_ids', 'category-a,category-b'],
    ['session_id', 'session-a'],
    ['retry_session_id', 'session-old'],
    ['exam_id', 'exam-a'],
    ['question_count', '40'],
    ['ticket_range_start', '2'],
    ['ticket_range_end', '8'],
    ['traffic_sign_ids', 'sign-a,sign-b'],
    ['has_image', 'true'],
    ['start_question', 'question-a'],
    ['skip_interval', 'true'],
  ])('changes when %s changes', (key, value) => {
    const baseline = buildNonBattleExamRouteIdentity(params({}));
    const changed = buildNonBattleExamRouteIdentity(params({ [key]: value }));
    expect(changed).not.toBe(baseline);
  });

  it.each([
    ['ticket_number', '12', 'ticket', '5'],
    ['category_ids', 'canonical', 'category', 'legacy'],
    ['session_id', 'canonical', 'session', 'legacy'],
    ['retry_session_id', 'canonical', 'retrySessionId', 'legacy'],
    ['exam_id', 'canonical', 'examId', 'legacy'],
  ])(
    'gives canonical %s precedence over %s',
    (canonicalKey, canonicalValue, legacyKey, legacyValue) => {
      const canonicalOnly = buildNonBattleExamRouteIdentity(
        params({ [canonicalKey]: canonicalValue }),
      );
      const both = buildNonBattleExamRouteIdentity(
        params({
          [canonicalKey]: canonicalValue,
          [legacyKey]: legacyValue,
        }),
      );
      expect(both).toBe(canonicalOnly);
    },
  );

  it('treats a present empty canonical parameter as authoritative', () => {
    expect(
      readAliasedSearchParam(
        params({ ticket_number: '', ticket: 'legacy' }),
        'ticket_number',
        'ticket',
      ),
    ).toBeUndefined();
  });

  it('keeps aliases compatible when a canonical parameter is absent', () => {
    const legacy = params({
      ticket: '9',
      category: 'category-a',
      session: 'session-a',
      retrySessionId: 'session-old',
      examId: 'exam-a',
    });
    const canonical = params({
      ticket_number: '9',
      category_ids: 'category-a',
      session_id: 'session-a',
      retry_session_id: 'session-old',
      exam_id: 'exam-a',
    });
    expect(buildNonBattleExamRouteIdentity(legacy)).toBe(
      buildNonBattleExamRouteIdentity(canonical),
    );
  });

  it('tracks the dashboard session independently', () => {
    const first = buildNonBattleExamRouteIdentity(
      params({ session_id: '', sessionId: 'dashboard-session-a' }),
    );
    const second = buildNonBattleExamRouteIdentity(
      params({ session_id: '', sessionId: 'dashboard-session-b' }),
    );
    expect(first).not.toBe(second);
  });

  it('cannot collide when values contain punctuation', () => {
    const left = buildNonBattleExamRouteIdentity(
      params({ ticket_number: '1-2', category_ids: '3' }),
    );
    const right = buildNonBattleExamRouteIdentity(
      params({ ticket_number: '1', category_ids: '2-3' }),
    );
    expect(left).not.toBe(right);
  });
});

describe('hasInvalidRetrySessionId', () => {
  const validUuid = '019842ba-3f0d-7c2e-9a41-6b5d0f2c8e71';

  it.each([
    [{}, false],
    [{ retrySessionId: validUuid }, false],
    [{ retry_session_id: validUuid }, false],
    [{ retrySessionId: 'not-a-uuid' }, true],
    [{ retry_session_id: '12345' }, true],
    [{ retrySessionId: '' }, false],
  ])('validates retry identity %o', (values, expected) => {
    expect(hasInvalidRetrySessionId(params(values))).toBe(expected);
  });

  it('gives a valid canonical value precedence over an invalid alias', () => {
    expect(
      hasInvalidRetrySessionId(
        params({
          retry_session_id: validUuid,
          retrySessionId: 'invalid',
        }),
      ),
    ).toBe(false);
  });
});
