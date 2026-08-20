import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  MODE_CONFIGS,
  parseExamResult,
  parseExamResultWire,
  parseExamSession,
  parseExamSessionWire,
  toExamResultWire,
  toExamSessionWire,
} from '../src/index.js';

const fixturePairSchema = z.object({ domain: z.unknown(), wire: z.unknown() }).strict();
const mutationSchema = z
  .object({ name: z.string(), field: z.string(), value: z.unknown() })
  .strict();
const nullableNormalizationSchema = z
  .object({ domainInput: z.unknown(), wireInput: z.unknown() })
  .strict();
const revisionBoundariesSchema = z
  .object({ maximum: z.number(), aboveMaximum: z.number() })
  .strict();
const rangeSchema = z.object({ min: z.number(), max: z.number(), default: z.number() });
const modeConfigSchema = z
  .object({
    mode: z.string(),
    questions: rangeSchema,
    durationMinutes: rangeSchema,
    timed: z.boolean(),
  })
  .strict();
const fixtureSchema = z
  .object({
    modeConfigs: z.array(modeConfigSchema),
    validSessions: z.array(fixturePairSchema),
    invalidSessionMutations: z.array(mutationSchema),
    nullableNormalization: nullableNormalizationSchema,
    revisionBoundaries: revisionBoundariesSchema,
    validResults: z.array(fixturePairSchema),
    invalidResultMutations: z.array(mutationSchema),
    pluralCases: z.array(z.unknown()),
    summaryCases: z.array(z.unknown()),
  })
  .strict();

function readFixture(): z.infer<typeof fixtureSchema> {
  const path = new URL('../../fixtures/exam-modes.json', import.meta.url);
  return fixtureSchema.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

const fixture = readFixture();

describe('shared exam-mode fixture parity', () => {
  it('keeps TypeScript mode configuration aligned with the shared fixture', () => {
    expect(Object.values(MODE_CONFIGS)).toEqual(fixture.modeConfigs);
  });

  it('validates every session before mapping it to the wire contract', () => {
    for (const pair of fixture.validSessions) {
      const domain = parseExamSession(pair.domain);
      expect(toExamSessionWire(domain)).toEqual(pair.wire);
      expect(parseExamSessionWire(pair.wire)).toEqual(domain);
    }
  });

  it('produces JSON-stable session wire values', () => {
    for (const pair of fixture.validSessions) {
      const wire = toExamSessionWire(parseExamSession(pair.domain));
      expect(JSON.parse(JSON.stringify(wire)) as unknown).toEqual(pair.wire);
    }
  });

  it('validates every result before mapping it to the wire contract', () => {
    for (const pair of fixture.validResults) {
      const domain = parseExamResult(pair.domain);
      expect(toExamResultWire(domain)).toEqual(pair.wire);
      expect(parseExamResultWire(pair.wire)).toEqual(domain);
    }
  });

  it('rejects all shared invalid session mutations', () => {
    const base = fixture.validSessions[0]?.domain;
    expect(base).toBeDefined();

    for (const mutation of fixture.invalidSessionMutations) {
      const candidate = { ...(base as object), [mutation.field]: mutation.value };
      expect(
        () => parseExamSession(candidate),
        `accepted invalid session: ${mutation.name}`,
      ).toThrow();
    }
  });

  it('normalizes omitted nullable timestamps identically at domain and wire boundaries', () => {
    const { domainInput, wireInput } = fixture.nullableNormalization;
    const domain = parseExamSession(domainInput);
    const fromWire = parseExamSessionWire(wireInput);

    expect(domain.startedAt).toBeNull();
    expect(domain.completedAt).toBeNull();
    expect(fromWire).toEqual(domain);
    expect(toExamSessionWire(fromWire)).toMatchObject({
      started_at: null,
      completed_at: null,
    });
  });

  it('accepts the shared uint32 revision maximum and rejects the next integer', () => {
    const base = fixture.validSessions[1]?.domain;
    expect(base).toBeDefined();
    expect(
      parseExamSession({
        ...(base as object),
        revision: fixture.revisionBoundaries.maximum,
      }).revision,
    ).toBe(fixture.revisionBoundaries.maximum);
    expect(() =>
      parseExamSession({
        ...(base as object),
        revision: fixture.revisionBoundaries.aboveMaximum,
      }),
    ).toThrow();
  });

  it('rejects all shared invalid result mutations', () => {
    const base = fixture.validResults[0]?.domain;
    expect(base).toBeDefined();

    for (const mutation of fixture.invalidResultMutations) {
      const candidate = { ...(base as object), [mutation.field]: mutation.value };
      expect(
        () => parseExamResult(candidate),
        `accepted invalid result: ${mutation.name}`,
      ).toThrow();
    }
  });

  it('rejects a malformed wire shape before domain conversion', () => {
    const wire = fixture.validSessions[0]?.wire;
    expect(wire).toBeDefined();
    expect(() => parseExamSessionWire({ ...(wire as object), private_data: true })).toThrow();
    expect(() => parseExamSessionWire({ ...(wire as object), question_count: '20' })).toThrow();
  });

  it('rejects a malformed result wire shape before domain conversion', () => {
    const wire = fixture.validResults[0]?.wire;
    expect(wire).toBeDefined();
    expect(() => parseExamResultWire({ ...(wire as object), passed: true })).toThrow();
    expect(() => parseExamResultWire({ ...(wire as object), correct_count: '17' })).toThrow();
  });
});
