export type LinkMethod = 'phone' | 'email';

export interface TelegramLiteProfile {
  id: string;
  displayName: string;
  identifierHint?: string;
  avatarUrl?: string | null;
}

export interface LinkChallenge {
  challengeHandle: string;
  method: LinkMethod;
  identifier: string;
  expiresIn: number;
  retryAfter: number;
  deliveryAccepted: true;
}

export interface LinkCandidate {
  confirmationToken: string;
  displayName: string;
  maskedIdentifier: string;
  expiresAt: string;
}

export interface TelegramLiteOnboardingStatus {
  state: 'choice_required' | 'bound';
  bindingGeneration: number;
  activeProfile: TelegramLiteProfile | null;
  trialGranted: boolean;
  trialExpiresAt: string | null;
}

export interface TelegramLiteBindingMutation {
  state: 'bound' | 'choice_required';
  bindingGeneration: number;
  activeProfile: TelegramLiteProfile | null;
}

interface LinkingBase {
  status: 'linking';
  attemptId: string;
  bindingGeneration: number;
  returnProfile: TelegramLiteProfile | null;
}

export type TelegramLiteState =
  | { status: 'loading' }
  | { status: 'error'; code: string; retryable: boolean }
  | { status: 'choice_required'; bindingGeneration: number }
  | { status: 'onboarding'; step: 'welcome'; bindingGeneration: number }
  | (LinkingBase & { step: 'identifier' })
  | (LinkingBase & { step: 'otp' } & LinkChallenge)
  | (LinkingBase & { step: 'candidate' } & LinkCandidate)
  | {
      status: 'bound';
      profile: TelegramLiteProfile;
      bindingGeneration: number;
    };

export type TelegramLiteEvent =
  | { type: 'STATUS_RESOLVED'; payload: TelegramLiteOnboardingStatus }
  | { type: 'AUTHORITATIVE_STATUS_SYNCED'; payload: TelegramLiteOnboardingStatus }
  | { type: 'SESSION_FAILED'; payload: { code: string; retryable: boolean } }
  | { type: 'RETRY_SESSION' }
  | { type: 'CHOOSE_NEW' }
  | { type: 'CHOOSE_EXISTING'; attemptId: string }
  | { type: 'CANCEL_ONBOARDING' }
  | { type: 'NEW_PROFILE_CREATED'; payload: TelegramLiteBindingMutation }
  | { type: 'LINK_CHALLENGE_CREATED'; attemptId: string; payload: LinkChallenge }
  | { type: 'CANDIDATE_RESOLVED'; attemptId: string; payload: LinkCandidate }
  | { type: 'PROFILE_BOUND'; attemptId: string; payload: TelegramLiteBindingMutation }
  | { type: 'PROFILE_SWITCHED'; payload: TelegramLiteBindingMutation }
  | { type: 'START_RELINK'; attemptId: string }
  | { type: 'PROFILE_UNLINKED'; payload: TelegramLiteBindingMutation }
  | {
      type: 'GENERATION_SYNCED';
      payload: { bindingGeneration: number; activeProfile?: TelegramLiteProfile | null };
    };

export const initialTelegramLiteState: TelegramLiteState = { status: 'loading' };

function boundFromMutation(mutation: TelegramLiteBindingMutation): TelegramLiteState | null {
  return mutation.state === 'bound' && mutation.activeProfile
    ? {
        status: 'bound',
        profile: mutation.activeProfile,
        bindingGeneration: mutation.bindingGeneration,
      }
    : null;
}

export function telegramLiteReducer(
  state: TelegramLiteState,
  event: TelegramLiteEvent,
): TelegramLiteState {
  if (
    (event.type === 'NEW_PROFILE_CREATED' ||
      event.type === 'PROFILE_BOUND' ||
      event.type === 'PROFILE_SWITCHED' ||
      event.type === 'PROFILE_UNLINKED') &&
    'bindingGeneration' in state &&
    event.payload.bindingGeneration < state.bindingGeneration
  ) {
    return state;
  }

  if (event.type === 'SESSION_FAILED') {
    return { status: 'error', ...event.payload };
  }

  if (event.type === 'AUTHORITATIVE_STATUS_SYNCED') {
    const currentGeneration = 'bindingGeneration' in state ? state.bindingGeneration : null;
    if (currentGeneration !== null && event.payload.bindingGeneration < currentGeneration) {
      return state;
    }
    if (event.payload.state === 'bound' && event.payload.activeProfile) {
      return {
        status: 'bound',
        profile: event.payload.activeProfile,
        bindingGeneration: event.payload.bindingGeneration,
      };
    }
    return {
      status: 'choice_required',
      bindingGeneration: event.payload.bindingGeneration,
    };
  }

  if (event.type === 'RETRY_SESSION' && state.status === 'error') {
    return initialTelegramLiteState;
  }

  if (event.type === 'STATUS_RESOLVED' && state.status === 'loading') {
    if (event.payload.state === 'bound' && event.payload.activeProfile) {
      return {
        status: 'bound',
        profile: event.payload.activeProfile,
        bindingGeneration: event.payload.bindingGeneration,
      };
    }
    return {
      status: 'choice_required',
      bindingGeneration: event.payload.bindingGeneration,
    };
  }

  if (event.type === 'CHOOSE_NEW' && state.status === 'choice_required') {
    return {
      status: 'onboarding',
      step: 'welcome',
      bindingGeneration: state.bindingGeneration,
    };
  }

  if (event.type === 'CHOOSE_EXISTING' && state.status === 'choice_required') {
    return {
      status: 'linking',
      step: 'identifier',
      attemptId: event.attemptId,
      bindingGeneration: state.bindingGeneration,
      returnProfile: null,
    };
  }

  if (event.type === 'CANCEL_ONBOARDING' && state.status === 'onboarding') {
    return {
      status: 'choice_required',
      bindingGeneration: state.bindingGeneration,
    };
  }

  if (event.type === 'CANCEL_ONBOARDING' && state.status === 'linking') {
    return state.returnProfile
      ? {
          status: 'bound',
          profile: state.returnProfile,
          bindingGeneration: state.bindingGeneration,
        }
      : {
          status: 'choice_required',
          bindingGeneration: state.bindingGeneration,
        };
  }

  if (event.type === 'NEW_PROFILE_CREATED' && state.status === 'onboarding') {
    return boundFromMutation(event.payload) ?? state;
  }

  if (
    event.type === 'LINK_CHALLENGE_CREATED' &&
    state.status === 'linking' &&
    state.step === 'identifier' &&
    event.attemptId === state.attemptId
  ) {
    return { ...state, step: 'otp', ...event.payload };
  }

  if (
    event.type === 'CANDIDATE_RESOLVED' &&
    state.status === 'linking' &&
    state.step === 'otp' &&
    event.attemptId === state.attemptId
  ) {
    return { ...state, step: 'candidate', ...event.payload };
  }

  if (
    event.type === 'PROFILE_BOUND' &&
    state.status === 'linking' &&
    state.step === 'candidate' &&
    event.attemptId === state.attemptId
  ) {
    return boundFromMutation(event.payload) ?? state;
  }

  if (event.type === 'PROFILE_SWITCHED' && state.status === 'bound') {
    return boundFromMutation(event.payload) ?? state;
  }

  if (event.type === 'START_RELINK' && state.status === 'bound') {
    return {
      status: 'linking',
      step: 'identifier',
      attemptId: event.attemptId,
      bindingGeneration: state.bindingGeneration,
      returnProfile: state.profile,
    };
  }

  if (event.type === 'PROFILE_UNLINKED' && state.status === 'bound') {
    return (
      boundFromMutation(event.payload) ?? {
        status: 'choice_required',
        bindingGeneration: event.payload.bindingGeneration,
      }
    );
  }

  if (event.type === 'GENERATION_SYNCED' && state.status === 'bound') {
    if (event.payload.bindingGeneration < state.bindingGeneration) {
      return state;
    }
    return {
      ...state,
      bindingGeneration: event.payload.bindingGeneration,
      profile: event.payload.activeProfile ?? state.profile,
    };
  }

  return state;
}
