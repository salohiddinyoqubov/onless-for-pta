import {
  ExamOwnerSequencer,
  type OwnerBoundary,
  type OwnerCoordinator,
} from '../src/exam/owner-sequencer';

describe('ExamOwnerSequencer', () => {
  it('does not clean up the active owner after a stale owner lookup', async () => {
    let finishOwnerLookup: ((ownerId: string | null) => void) | undefined;
    const ownerLookup = new Promise<string | null>((resolve) => {
      finishOwnerLookup = resolve;
    });
    const coordinator: OwnerCoordinator = {
      cancelOwner: jest.fn(async () => undefined),
    };
    const boundary: OwnerBoundary = {
      currentOwner: jest.fn(() => ownerLookup),
      activate: jest.fn(async () => undefined),
      logout: jest.fn(async () => undefined),
    };
    const sequencer = new ExamOwnerSequencer(
      coordinator,
      boundary,
      jest.fn(),
    );

    const switchToB = sequencer.transition('owner-b');
    await Promise.resolve();
    const remainOnA = sequencer.transition('owner-a');
    finishOwnerLookup?.('owner-a');

    await expect(switchToB).resolves.toBe(false);
    await expect(remainOnA).resolves.toBe(true);
    expect(coordinator.cancelOwner).not.toHaveBeenCalled();
    expect(boundary.logout).not.toHaveBeenCalled();
    expect(boundary.activate).toHaveBeenCalledWith('owner-a');
  });

  it('coalesces rapid transitions without activating a stale owner', async () => {
    const events: string[] = [];
    const coordinator: OwnerCoordinator = {
      cancelOwner: jest.fn(async (ownerId: string) => {
        events.push(`cancel:${ownerId}`);
      }),
    };
    const boundary: OwnerBoundary = {
      currentOwner: jest.fn(async () => 'owner-a'),
      activate: jest.fn(async (ownerId: string) => {
        events.push(`activate:${ownerId}`);
      }),
      logout: jest.fn(async (ownerId: string) => {
        events.push(`logout:${ownerId}`);
      }),
    };
    const visibleOwners: Array<string | null> = [];
    const sequencer = new ExamOwnerSequencer(
      coordinator,
      boundary,
      (ownerId) => visibleOwners.push(ownerId),
    );

    const switchToB = sequencer.transition('owner-b');
    const switchToC = sequencer.transition('owner-c');

    await expect(switchToB).resolves.toBe(false);
    await expect(switchToC).resolves.toBe(true);
    expect(events).toEqual([
      'cancel:owner-a',
      'logout:owner-a',
      'activate:owner-c',
    ]);
    expect(boundary.activate).not.toHaveBeenCalledWith('owner-b');
    expect(visibleOwners).toEqual([null, 'owner-c']);
  });

  it('completes cancellation before destructive logout cleanup', async () => {
    let finishCancellation: (() => void) | undefined;
    const cancellation = new Promise<void>((resolve) => {
      finishCancellation = resolve;
    });
    const coordinator: OwnerCoordinator = {
      cancelOwner: jest.fn(() => cancellation),
    };
    const boundary: OwnerBoundary = {
      currentOwner: jest.fn(async () => 'owner-a'),
      activate: jest.fn(async () => undefined),
      logout: jest.fn(async () => undefined),
    };
    const sequencer = new ExamOwnerSequencer(
      coordinator,
      boundary,
      jest.fn(),
    );

    const logout = sequencer.transition(null);
    await Promise.resolve();
    await Promise.resolve();

    expect(coordinator.cancelOwner).toHaveBeenCalledWith('owner-a');
    expect(boundary.logout).not.toHaveBeenCalled();

    finishCancellation?.();
    await expect(logout).resolves.toBe(true);
    expect(boundary.logout).toHaveBeenCalledWith('owner-a');
  });

  it('notifies logout from an active owner exactly once', async () => {
    const coordinator: OwnerCoordinator = {
      cancelOwner: jest.fn(async () => undefined),
    };
    const boundary: OwnerBoundary = {
      currentOwner: jest.fn(async () => 'owner-a'),
      activate: jest.fn(async () => undefined),
      logout: jest.fn(async () => undefined),
    };
    const onOwnerChanged = jest.fn();
    const sequencer = new ExamOwnerSequencer(
      coordinator,
      boundary,
      onOwnerChanged,
    );

    await expect(sequencer.transition(null)).resolves.toBe(true);
    expect(onOwnerChanged).toHaveBeenCalledTimes(1);
    expect(onOwnerChanged).toHaveBeenCalledWith(null);
  });

  it('suppresses an owner that becomes stale during activation', async () => {
    let finishActivation: (() => void) | undefined;
    const activation = new Promise<void>((resolve) => {
      finishActivation = resolve;
    });
    const events: string[] = [];
    const coordinator: OwnerCoordinator = {
      cancelOwner: jest.fn(async (ownerId: string) => {
        events.push(`cancel:${ownerId}`);
      }),
    };
    const boundary: OwnerBoundary = {
      currentOwner: jest.fn(async () => null),
      activate: jest.fn((ownerId: string) => {
        events.push(`activate:${ownerId}`);
        return ownerId === 'owner-b' ? activation : Promise.resolve();
      }),
      logout: jest.fn(async (ownerId: string) => {
        events.push(`logout:${ownerId}`);
      }),
    };
    const onOwnerChanged = jest.fn();
    const sequencer = new ExamOwnerSequencer(
      coordinator,
      boundary,
      onOwnerChanged,
    );

    const switchToB = sequencer.transition('owner-b');
    await Promise.resolve();
    await Promise.resolve();
    expect(boundary.activate).toHaveBeenCalledWith('owner-b');

    const switchToC = sequencer.transition('owner-c');
    finishActivation?.();

    await expect(switchToB).resolves.toBe(false);
    await expect(switchToC).resolves.toBe(true);
    expect(events).toEqual([
      'activate:owner-b',
      'cancel:owner-b',
      'logout:owner-b',
      'activate:owner-c',
    ]);
    expect(onOwnerChanged).not.toHaveBeenCalledWith('owner-b');
    expect(onOwnerChanged).toHaveBeenLastCalledWith('owner-c');
  });

  it('fails closed when owner cleanup fails', async () => {
    const cleanupError = new Error('local cleanup failed');
    const coordinator: OwnerCoordinator = {
      cancelOwner: jest.fn(async () => undefined),
    };
    const boundary: OwnerBoundary = {
      currentOwner: jest.fn(async () => 'owner-a'),
      activate: jest.fn(async () => undefined),
      logout: jest.fn(async () => Promise.reject(cleanupError)),
    };
    const onOwnerChanged = jest.fn();
    const sequencer = new ExamOwnerSequencer(
      coordinator,
      boundary,
      onOwnerChanged,
    );

    await expect(sequencer.transition('owner-b')).rejects.toBe(cleanupError);
    expect(boundary.activate).not.toHaveBeenCalled();
    expect(onOwnerChanged).toHaveBeenCalledWith(null);
  });
});
