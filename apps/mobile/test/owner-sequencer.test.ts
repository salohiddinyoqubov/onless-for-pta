import {
  ExamOwnerSequencer,
  type OwnerBoundary,
  type OwnerCoordinator,
} from '../src/exam/owner-sequencer';
import { DEMO_OWNER_ID, SECOND_OWNER_ID } from './fixtures';
const THIRD_OWNER_ID = '00000000-0000-4000-8000-000000000003';
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
    const switchToB = sequencer.transition(SECOND_OWNER_ID);
    await Promise.resolve();
    const remainOnA = sequencer.transition(DEMO_OWNER_ID);
    finishOwnerLookup?.(DEMO_OWNER_ID);
    await expect(switchToB).resolves.toBe(false);
    await expect(remainOnA).resolves.toBe(true);
    expect(coordinator.cancelOwner).not.toHaveBeenCalled();
    expect(boundary.logout).not.toHaveBeenCalled();
    expect(boundary.activate).toHaveBeenCalledWith(DEMO_OWNER_ID);
  });
  it('coalesces rapid transitions without activating a stale owner', async () => {
    const events: string[] = [];
    const coordinator: OwnerCoordinator = {
      cancelOwner: jest.fn(async (ownerId: string) => {
        events.push(`cancel:${ownerId}`);
      }),
    };
    const boundary: OwnerBoundary = {
      currentOwner: jest.fn(async () => DEMO_OWNER_ID),
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
    const switchToB = sequencer.transition(SECOND_OWNER_ID);
    const switchToC = sequencer.transition(THIRD_OWNER_ID);
    await expect(switchToB).resolves.toBe(false);
    await expect(switchToC).resolves.toBe(true);
    expect(events).toEqual([
      `cancel:${DEMO_OWNER_ID}`,
      `logout:${DEMO_OWNER_ID}`,
      `activate:${THIRD_OWNER_ID}`,
    ]);
    expect(boundary.activate).not.toHaveBeenCalledWith(SECOND_OWNER_ID);
    expect(visibleOwners).toEqual([null, THIRD_OWNER_ID]);
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
      currentOwner: jest.fn(async () => DEMO_OWNER_ID),
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
    expect(coordinator.cancelOwner).toHaveBeenCalledWith(DEMO_OWNER_ID);
    expect(boundary.logout).not.toHaveBeenCalled();
    finishCancellation?.();
    await expect(logout).resolves.toBe(true);
    expect(boundary.logout).toHaveBeenCalledWith(DEMO_OWNER_ID);
  });
  it('notifies logout from an active owner exactly once', async () => {
    const coordinator: OwnerCoordinator = {
      cancelOwner: jest.fn(async () => undefined),
    };
    const boundary: OwnerBoundary = {
      currentOwner: jest.fn(async () => DEMO_OWNER_ID),
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
        return ownerId === SECOND_OWNER_ID ? activation : Promise.resolve();
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
    const switchToB = sequencer.transition(SECOND_OWNER_ID);
    await Promise.resolve();
    await Promise.resolve();
    expect(boundary.activate).toHaveBeenCalledWith(SECOND_OWNER_ID);
    const switchToC = sequencer.transition(THIRD_OWNER_ID);
    finishActivation?.();
    await expect(switchToB).resolves.toBe(false);
    await expect(switchToC).resolves.toBe(true);
    expect(events).toEqual([
      `activate:${SECOND_OWNER_ID}`,
      `cancel:${SECOND_OWNER_ID}`,
      `logout:${SECOND_OWNER_ID}`,
      `activate:${THIRD_OWNER_ID}`,
    ]);
    expect(onOwnerChanged).not.toHaveBeenCalledWith(SECOND_OWNER_ID);
    expect(onOwnerChanged).toHaveBeenLastCalledWith(THIRD_OWNER_ID);
  });
  it('fails closed when owner cleanup fails', async () => {
    const cleanupError = new Error('local cleanup failed');
    const coordinator: OwnerCoordinator = {
      cancelOwner: jest.fn(async () => undefined),
    };
    const boundary: OwnerBoundary = {
      currentOwner: jest.fn(async () => DEMO_OWNER_ID),
      activate: jest.fn(async () => undefined),
      logout: jest.fn(async () => Promise.reject(cleanupError)),
    };
    const onOwnerChanged = jest.fn();
    const sequencer = new ExamOwnerSequencer(
      coordinator,
      boundary,
      onOwnerChanged,
    );
    await expect(sequencer.transition(SECOND_OWNER_ID)).rejects.toBe(cleanupError);
    expect(boundary.activate).not.toHaveBeenCalled();
    expect(onOwnerChanged).toHaveBeenCalledWith(null);
  });
});
