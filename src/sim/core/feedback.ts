/** Which module's result enum `CommandFeedback.code` belongs to. */
export const enum FeedbackDomain {
  None = 0,
  /** `TrackResult` */
  Track = 1,
  /** `RideResult` */
  Ride = 2,
  /** `EconomyResult` */
  Economy = 3,
  /** `PathResult` */
  Path = 4,
  /** `LandResult` */
  Land = 5,
}

/**
 * Outcome of the most recent player command or sim-driven ride event, published to the UI in
 * snapshots. `seq` increments on every report so a repeated identical outcome is still visible.
 * Not part of the hashed or saved state.
 */
export interface CommandFeedback {
  seq: number;
  domain: FeedbackDomain;
  code: number;
  /** Ride id the outcome concerns, tile index for path results, or -1. */
  subject: number;
}

export function createFeedback(): CommandFeedback {
  return { seq: 0, domain: FeedbackDomain.None, code: 0, subject: -1 };
}

export function reportFeedback(
  feedback: CommandFeedback,
  domain: FeedbackDomain,
  code: number,
  subject = -1,
): void {
  feedback.seq++;
  feedback.domain = domain;
  feedback.code = code;
  feedback.subject = subject;
}
