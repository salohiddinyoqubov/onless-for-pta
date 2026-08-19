import { buildExamLaunchHref, type ExamLaunchDescriptor } from '../src/exam/launch-contract';

const validDescriptor = {
  target: 'mode',
  locale: 'uz',
  role: 'student',
  mode: 'battle',
  intent: 'force_new',
  entrySurface: 'dashboard',
  filters: { battleId: 'battle-a' },
} as const satisfies ExamLaunchDescriptor;

buildExamLaunchHref(validDescriptor);

const invalidDescriptor = {
  target: 'mode',
  locale: 'uz',
  role: 'student',
  mode: 'daily',
  intent: 'force_new',
  entrySurface: 'dashboard',
  filters: { battleId: 'battle-a' },
} as const;

// @ts-expect-error Plain modes cannot carry battle filters.
buildExamLaunchHref(invalidDescriptor);
