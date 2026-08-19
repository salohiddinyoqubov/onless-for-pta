import { describe, expect, it } from 'vitest';

import {
  initialTelegramLiteState,
  telegramLiteReducer,
  type TelegramLiteProfile,
} from '../src/linking-state-machine.js';

const profile: TelegramLiteProfile = {
  id: 'profile-1',
  displayName: 'Ali Valiyev',
  identifierHint: '+***1234',
};

const newerProfile: TelegramLiteProfile = {
  ...profile,
  id: 'profile-3',
  displayName: 'Ali Three',
};

describe('Telegram Lite linking state machine', () => {
  it('routes from canonical onboarding status and preserves generation', () => {
    const state = telegramLiteReducer(initialTelegramLiteState, {
      type: 'STATUS_RESOLVED',
      payload: {
        state: 'choice_required',
        bindingGeneration: 4,
        activeProfile: null,
        trialGranted: false,
        trialExpiresAt: null,
      },
    });

    expect(state).toEqual({ status: 'choice_required', bindingGeneration: 4 });
    expect(
      telegramLiteReducer(state, {
        type: 'CHOOSE_EXISTING',
        attemptId: 'attempt-1',
      }),
    ).toEqual({
      status: 'linking',
      step: 'identifier',
      attemptId: 'attempt-1',
      bindingGeneration: 4,
      returnProfile: null,
    });
  });

  it('requires challenge, proof, and confirmation before binding', () => {
    const identifierState = {
      status: 'linking' as const,
      step: 'identifier' as const,
      attemptId: 'attempt-1',
      bindingGeneration: 0,
      returnProfile: null,
    };
    const otpState = telegramLiteReducer(identifierState, {
      type: 'LINK_CHALLENGE_CREATED',
      attemptId: 'attempt-1',
      payload: {
        challengeHandle: 'challenge-handle',
        method: 'email',
        identifier: 'ali@example.com',
        expiresIn: 300,
        retryAfter: 60,
        deliveryAccepted: true,
      },
    });
    expect(otpState).toMatchObject({ step: 'otp', challengeHandle: 'challenge-handle' });

    const candidateState = telegramLiteReducer(otpState, {
      type: 'CANDIDATE_RESOLVED',
      attemptId: 'attempt-1',
      payload: {
        confirmationToken: 'confirmation-token',
        displayName: 'Ali Valiyev',
        maskedIdentifier: 'a***@example.com',
        expiresAt: '2026-08-13T12:05:00Z',
      },
    });
    expect(candidateState).toMatchObject({
      status: 'linking',
      step: 'candidate',
      confirmationToken: 'confirmation-token',
    });

    expect(
      telegramLiteReducer(candidateState, {
        type: 'PROFILE_BOUND',
        attemptId: 'attempt-1',
        payload: {
          state: 'bound',
          bindingGeneration: 1,
          activeProfile: profile,
        },
      }),
    ).toEqual({
      status: 'bound',
      profile,
      bindingGeneration: 1,
    });
  });

  it('ignores an out-of-order mutation instead of skipping verification', () => {
    const state = {
      status: 'linking' as const,
      step: 'identifier' as const,
      attemptId: 'attempt-1',
      bindingGeneration: 0,
      returnProfile: null,
    };

    expect(
      telegramLiteReducer(state, {
        type: 'PROFILE_BOUND',
        attemptId: 'attempt-1',
        payload: {
          state: 'bound',
          bindingGeneration: 1,
          activeProfile: profile,
        },
      }),
    ).toBe(state);
  });

  it('preserves the current profile when relinking is cancelled and applies unlink generation', () => {
    const bound = {
      status: 'bound' as const,
      profile,
      bindingGeneration: 7,
    };
    const relinking = telegramLiteReducer(bound, {
      type: 'START_RELINK',
      attemptId: 'attempt-1',
    });
    expect(relinking).toMatchObject({
      status: 'linking',
      step: 'identifier',
      attemptId: 'attempt-1',
      bindingGeneration: 7,
      returnProfile: profile,
    });
    expect(telegramLiteReducer(relinking, { type: 'CANCEL_ONBOARDING' })).toEqual(bound);
    expect(
      telegramLiteReducer(bound, {
        type: 'PROFILE_UNLINKED',
        payload: {
          state: 'choice_required',
          bindingGeneration: 8,
          activeProfile: null,
        },
      }),
    ).toEqual({ status: 'choice_required', bindingGeneration: 8 });
  });

  it.each([
    {
      name: 'new-profile',
      state: {
        status: 'onboarding' as const,
        step: 'welcome' as const,
        bindingGeneration: 2,
      },
      event: {
        type: 'NEW_PROFILE_CREATED' as const,
        payload: { state: 'bound' as const, bindingGeneration: 1, activeProfile: profile },
      },
    },
    {
      name: 'profile-bound',
      state: {
        status: 'linking' as const,
        step: 'candidate' as const,
        attemptId: 'attempt-1',
        bindingGeneration: 2,
        returnProfile: newerProfile,
        confirmationToken: 'confirmation-token',
        displayName: 'Ali Valiyev',
        maskedIdentifier: 'a***@example.com',
        expiresAt: '2026-08-13T12:05:00Z',
      },
      event: {
        type: 'PROFILE_BOUND' as const,
        attemptId: 'attempt-1',
        payload: { state: 'bound' as const, bindingGeneration: 1, activeProfile: profile },
      },
    },
    {
      name: 'profile-switched',
      state: { status: 'bound' as const, profile: newerProfile, bindingGeneration: 2 },
      event: {
        type: 'PROFILE_SWITCHED' as const,
        payload: { state: 'bound' as const, bindingGeneration: 1, activeProfile: profile },
      },
    },
    {
      name: 'profile-unlinked',
      state: { status: 'bound' as const, profile: newerProfile, bindingGeneration: 2 },
      event: {
        type: 'PROFILE_UNLINKED' as const,
        payload: { state: 'bound' as const, bindingGeneration: 1, activeProfile: profile },
      },
    },
  ])('rejects an older $name mutation without rolling back authority', ({ state, event }) => {
    expect(telegramLiteReducer(state, event)).toBe(state);
  });

  it('rejects responses from a cancelled linking attempt', () => {
    const choiceRequired = { status: 'choice_required' as const, bindingGeneration: 4 };
    const firstAttempt = telegramLiteReducer(choiceRequired, {
      type: 'CHOOSE_EXISTING',
      attemptId: 'attempt-1',
    });
    const cancelled = telegramLiteReducer(firstAttempt, { type: 'CANCEL_ONBOARDING' });
    const currentAttempt = telegramLiteReducer(cancelled, {
      type: 'CHOOSE_EXISTING',
      attemptId: 'attempt-2',
    });

    const staleChallenge = telegramLiteReducer(currentAttempt, {
      type: 'LINK_CHALLENGE_CREATED',
      attemptId: 'attempt-1',
      payload: {
        challengeHandle: 'stale-challenge',
        method: 'email',
        identifier: 'user@example.com',
        expiresIn: 300,
        retryAfter: 60,
        deliveryAccepted: true,
      },
    });
    expect(staleChallenge).toBe(currentAttempt);

    const otpState = telegramLiteReducer(currentAttempt, {
      type: 'LINK_CHALLENGE_CREATED',
      attemptId: 'attempt-2',
      payload: {
        challengeHandle: 'current-challenge',
        method: 'email',
        identifier: 'user@example.com',
        expiresIn: 300,
        retryAfter: 60,
        deliveryAccepted: true,
      },
    });
    expect(
      telegramLiteReducer(otpState, {
        type: 'CANDIDATE_RESOLVED',
        attemptId: 'attempt-1',
        payload: {
          confirmationToken: 'stale-confirmation',
          displayName: 'Stale Profile',
          maskedIdentifier: 'u***@example.com',
          expiresAt: '2026-08-13T12:05:00Z',
        },
      }),
    ).toBe(otpState);

    const candidateState = telegramLiteReducer(otpState, {
      type: 'CANDIDATE_RESOLVED',
      attemptId: 'attempt-2',
      payload: {
        confirmationToken: 'current-confirmation',
        displayName: 'Current Profile',
        maskedIdentifier: 'u***@example.com',
        expiresAt: '2026-08-13T12:05:00Z',
      },
    });
    expect(
      telegramLiteReducer(candidateState, {
        type: 'PROFILE_BOUND',
        attemptId: 'attempt-1',
        payload: {
          state: 'bound',
          bindingGeneration: 5,
          activeProfile: profile,
        },
      }),
    ).toBe(candidateState);
  });

  it('never lets an out-of-order read response roll generation backwards', () => {
    const state = {
      status: 'bound' as const,
      profile,
      bindingGeneration: 9,
    };
    expect(
      telegramLiteReducer(state, {
        type: 'GENERATION_SYNCED',
        payload: {
          bindingGeneration: 8,
          activeProfile: { ...profile, displayName: 'Stale profile' },
        },
      }),
    ).toBe(state);
  });

  it('replaces profile identity only from an authoritative status sync', () => {
    const state = {
      status: 'bound' as const,
      profile,
      bindingGeneration: 9,
    };
    expect(
      telegramLiteReducer(state, {
        type: 'AUTHORITATIVE_STATUS_SYNCED',
        payload: {
          state: 'bound',
          bindingGeneration: 10,
          activeProfile: { ...profile, id: 'profile-2', displayName: 'Vali Aliyev' },
          trialGranted: false,
          trialExpiresAt: null,
        },
      }),
    ).toEqual({
      status: 'bound',
      profile: { ...profile, id: 'profile-2', displayName: 'Vali Aliyev' },
      bindingGeneration: 10,
    });
  });

  it('fails closed when authoritative status has no active identity', () => {
    const state = {
      status: 'bound' as const,
      profile,
      bindingGeneration: 9,
    };
    expect(
      telegramLiteReducer(state, {
        type: 'AUTHORITATIVE_STATUS_SYNCED',
        payload: {
          state: 'choice_required',
          bindingGeneration: 10,
          activeProfile: null,
          trialGranted: false,
          trialExpiresAt: null,
        },
      }),
    ).toEqual({ status: 'choice_required', bindingGeneration: 10 });
  });
});
