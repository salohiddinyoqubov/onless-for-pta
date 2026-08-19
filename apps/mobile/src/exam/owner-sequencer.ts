export interface OwnerBoundary {
  currentOwner(): Promise<string | null>;
  activate(ownerId: string): Promise<void>;
  logout(ownerId: string): Promise<void>;
}

export interface OwnerCoordinator {
  cancelOwner(ownerId: string): Promise<void>;
}

export type OwnerChangedHandler = (ownerId: string | null) => void;

/**
 * Serializes account changes around owner-scoped local exam data.
 * Superseded requests may be coalesced, but cleanup for the active owner always
 * completes before a replacement owner is activated.
 */
export class ExamOwnerSequencer {
  private requestedGeneration = 0;
  private currentOwnerId: string | null | undefined;
  private tail: Promise<void> = Promise.resolve();

  public constructor(
    private readonly coordinator: OwnerCoordinator,
    private readonly boundary: OwnerBoundary,
    private readonly onOwnerChanged: OwnerChangedHandler,
  ) {}

  public transition(nextOwnerId: string | null): Promise<boolean> {
    const generation = ++this.requestedGeneration;
    const operation = this.tail.then(() => this.apply(generation, nextOwnerId));

    this.tail = operation.then(
      () => undefined,
      () => undefined,
    );

    return operation;
  }

  public waitForIdle(): Promise<void> {
    return this.tail;
  }

  private async apply(
    generation: number,
    nextOwnerId: string | null,
  ): Promise<boolean> {
    if (generation !== this.requestedGeneration) {
      return false;
    }

    if (this.currentOwnerId === undefined) {
      this.currentOwnerId = await this.boundary.currentOwner();
    }

    if (generation !== this.requestedGeneration) {
      return false;
    }

    const previousOwnerId = this.currentOwnerId;
    if (previousOwnerId !== null && previousOwnerId !== nextOwnerId) {
      this.onOwnerChanged(null);
      await this.coordinator.cancelOwner(previousOwnerId);
      await this.boundary.logout(previousOwnerId);
      this.currentOwnerId = null;
    }

    if (generation !== this.requestedGeneration) {
      return false;
    }

    if (nextOwnerId === null) {
      if (previousOwnerId === null) {
        this.onOwnerChanged(null);
      }
      return true;
    }

    await this.boundary.activate(nextOwnerId);
    this.currentOwnerId = nextOwnerId;

    if (generation !== this.requestedGeneration) {
      return false;
    }

    this.onOwnerChanged(nextOwnerId);
    return true;
  }
}
