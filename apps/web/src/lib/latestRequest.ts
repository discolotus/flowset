export interface LatestRequestToken {
  isCurrent: () => boolean;
}

export class LatestRequestGuard {
  private revision = 0;

  begin(): LatestRequestToken {
    const requestRevision = this.revision + 1;
    this.revision = requestRevision;
    return {
      isCurrent: () => this.revision === requestRevision,
    };
  }

  invalidate(): void {
    this.revision += 1;
  }
}
