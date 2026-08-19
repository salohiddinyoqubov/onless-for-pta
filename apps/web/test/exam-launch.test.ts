import { describe, expect, it } from 'vitest';

import {
  assertExamLaunchDescriptor,
  buildDashboardBaseHref,
  buildExamLaunchHref,
  buildExamPrefetchHref,
  resolveDashboardBaseHref,
  type ExamLaunchDescriptor,
} from '../src/exam/launch-contract';

describe('exam launch contract', () => {
  it.each<{ descriptor: ExamLaunchDescriptor; expected: string }>([
    {
      descriptor: {
        target: 'ticket',
        locale: 'uz',
        role: 'student',
        mode: 'training',
        intent: 'resume_or_create',
        entrySurface: 'practice',
        ticketNumber: 7,
      },
      expected:
        '/uz/dashboard/student/exam?launch_type=ticket&mode=training&intent=resume_or_create&entry_surface=practice&ticket_number=7',
    },
    {
      descriptor: {
        target: 'category',
        locale: 'ru',
        role: 'student',
        mode: 'category',
        intent: 'force_new',
        entrySurface: 'category',
        categoryIds: ['topic-a', 'topic-b'],
        questionCount: 30,
      },
      expected:
        '/ru/dashboard/student/exam?launch_type=category&mode=category&intent=force_new&entry_surface=category&category_ids=topic-a%2Ctopic-b&question_count=30',
    },
    {
      descriptor: {
        target: 'session',
        locale: 'kaa',
        role: 'mentor',
        mode: 'battle',
        intent: 'resume_or_create',
        entrySurface: 'dashboard',
        sessionId: 'session-a',
        battleId: 'battle-a',
      },
      expected:
        '/kaa/dashboard/mentor/exam?launch_type=session&mode=battle&intent=resume_or_create&entry_surface=dashboard&session_id=session-a&battle_id=battle-a',
    },
    {
      descriptor: {
        target: 'retry',
        locale: 'uz-Cyrl',
        role: 'curator',
        mode: 'exam',
        intent: 'force_new',
        entrySurface: 'tests',
        sessionId: 'session-a',
        examId: 'exam-a',
      },
      expected:
        '/uz-Cyrl/dashboard/curator/exam?launch_type=retry&mode=exam&intent=force_new&entry_surface=tests&retry_session_id=session-a&exam_id=exam-a',
    },
    {
      descriptor: {
        target: 'mode',
        locale: 'uz',
        role: 'student',
        mode: 'saved',
        intent: 'resume_or_create',
        entrySurface: 'saved',
        filters: { startQuestionId: 'question-a' },
      },
      expected:
        '/uz/dashboard/student/exam?launch_type=mode&mode=saved&intent=resume_or_create&entry_surface=saved&start_question=question-a',
    },
  ])('serializes $descriptor.target launches', ({ descriptor, expected }) => {
    expect(buildExamLaunchHref(descriptor)).toBe(expected);
  });

  it('collapses query variants to one route-shell prefetch target', () => {
    expect(
      buildExamPrefetchHref({ locale: 'uz', role: 'student' }),
    ).toBe('/uz/dashboard/student/exam');
  });

  it('rejects path injection at the dashboard boundary', () => {
    expect(() =>
      buildDashboardBaseHref({ locale: '../admin', role: 'student' }),
    ).toThrow('Unsupported exam locale');
    expect(() =>
      buildDashboardBaseHref({
        locale: 'uz',
        role: 'student/../../admin',
      }),
    ).toThrow('Unsupported exam role');
  });

  it('falls back safely for invalid untrusted route parameters', () => {
    expect(resolveDashboardBaseHref({ locale: 'uz', role: 'student' })).toBe(
      '/uz/dashboard/student',
    );
    expect(
      resolveDashboardBaseHref({
        locale: 'uz',
        role: 'student/../../admin',
      }),
    ).toBe('/');
    expect(
      resolveDashboardBaseHref({ locale: '../admin', role: 'student' }),
    ).toBe('/');
  });

  it.each([
    [
      'selector leakage',
      {
        target: 'mode',
        locale: 'uz',
        role: 'student',
        mode: 'daily',
        intent: 'force_new',
        entrySurface: 'dashboard',
        ticketNumber: 7,
      },
      'Unexpected mode launch field',
    ],
    [
      'empty categories',
      {
        target: 'category',
        locale: 'uz',
        role: 'student',
        mode: 'category',
        intent: 'force_new',
        entrySurface: 'category',
        categoryIds: [],
      },
      'categoryIds must contain at least one non-empty id',
    ],
    [
      'entry-surface mismatch',
      {
        target: 'retry',
        locale: 'uz',
        role: 'student',
        mode: 'exam',
        intent: 'force_new',
        entrySurface: 'dashboard',
        sessionId: 'session-a',
      },
      'dashboard is not valid for retry launch',
    ],
    [
      'battle filters',
      {
        target: 'mode',
        locale: 'uz',
        role: 'student',
        mode: 'battle',
        intent: 'force_new',
        entrySurface: 'dashboard',
      },
      'battle requires battleId',
    ],
  ])('rejects invalid runtime input: %s', (_name, value, message) => {
    expect(() => {
      assertExamLaunchDescriptor(value);
    }).toThrow(message);
  });
});
