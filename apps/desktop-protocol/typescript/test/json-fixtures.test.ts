import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  parseClientToServer,
  parseServerToClient,
  parseWireMessage,
} from '../src/protocol.js';

function readFixtures(fileName: string): unknown[] {
  const path = new URL(`../../fixtures/${fileName}`, import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8')) as unknown[];
}

describe('Rust protocol parity', () => {
  it('accepts and preserves every server-to-client fixture', () => {
    const fixtures = readFixtures('server-to-client.json');
    expect(
      fixtures.map((fixture) => (fixture as { type: string }).type).sort(),
    ).toEqual([
      'AnswerAck',
      'AnswerError',
      'ConfigUpdate',
      'ExamQuestion',
      'ExamStart',
      'ExamStop',
      'Ping',
      'PowerCommand',
      'ServerShutdown',
    ]);

    for (const fixture of fixtures) {
      const message = parseServerToClient(fixture);
      expect(JSON.parse(JSON.stringify(message))).toEqual(fixture);
    }
  });

  it('accepts and preserves every client-to-server fixture', () => {
    const fixtures = readFixtures('client-to-server.json');
    expect(
      fixtures.map((fixture) => (fixture as { type: string }).type).sort(),
    ).toEqual([
      'AnswerSubmit',
      'ExamComplete',
      'Heartbeat',
      'Pong',
      'Register',
      'SubmitStudentInfo',
    ]);

    for (const fixture of fixtures) {
      const message = parseClientToServer(fixture);
      expect(JSON.parse(JSON.stringify(message))).toEqual(fixture);
    }
  });

  it('rejects malformed discriminants', () => {
    for (const fixture of readFixtures('malformed-discriminants.json')) {
      expect(() => parseWireMessage(fixture)).toThrow();
    }
  });

  it('requires a canonical connection code when registering', () => {
    const registration = {
      type: 'Register',
      client_id: 'kiosk-01',
      client_name: 'Exam Kiosk 01',
      version: '1.0.0',
      mac_address: null,
    };

    expect(() => parseClientToServer(registration)).toThrow();
    expect(() =>
      parseClientToServer({ ...registration, connection_code: 'NOT-A-CODE' }),
    ).toThrow();
  });

  it('normalizes omitted Rust Option fields to null', () => {
    expect(
      parseClientToServer({
        type: 'Register',
        client_id: 'kiosk-01',
        client_name: 'Exam Kiosk 01',
        version: '1.0.0',
        connection_code: '7J8D-9MQS',
      }),
    ).toEqual({
      type: 'Register',
      client_id: 'kiosk-01',
      client_name: 'Exam Kiosk 01',
      version: '1.0.0',
      mac_address: null,
      connection_code: '7J8D-9MQS',
    });
  });

  it('requires question image fields to be provided together', () => {
    for (const fixture of readFixtures('partial-image-pairs.json')) {
      expect(() => parseServerToClient(fixture)).toThrow();
    }
  });

  it('rejects noncanonical or non-v4 UUIDs', () => {
    for (const fixture of readFixtures('invalid-uuids.json')) {
      const { case: caseName, value } = fixture as {
        case: string;
        value: string;
      };

      expect(
        () =>
          parseClientToServer({
            type: 'ExamComplete',
            session_id: value,
            total_time_seconds: 1,
          }),
        `accepted invalid UUID fixture: ${caseName}`,
      ).toThrow();
    }
  });
});
