use std::time::Duration;

use rand::Rng;

pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);
pub const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(15);
pub const RECONNECT_INITIAL_DELAY: Duration = Duration::from_secs(1);
pub const RECONNECT_MAX_DELAY: Duration = Duration::from_secs(30);
pub const RECONNECT_JITTER_BASIS_POINTS: i16 = 2_000;

#[must_use]
pub fn next_reconnect_delay(attempt: u32) -> Duration {
    let jitter = rand::thread_rng()
        .gen_range(-RECONNECT_JITTER_BASIS_POINTS..=RECONNECT_JITTER_BASIS_POINTS);
    reconnect_delay(attempt, jitter)
}

/// Calculates exponential backoff from a signed jitter in basis points.
///
/// The jitter is clamped to ±20%. Accepting it separately keeps the timing
/// policy deterministic in tests.
#[must_use]
pub fn reconnect_delay(attempt: u32, jitter_basis_points: i16) -> Duration {
    let multiplier = 1_u64.checked_shl(attempt).unwrap_or(u64::MAX);
    let base_millis = RECONNECT_INITIAL_DELAY
        .as_secs()
        .saturating_mul(1_000)
        .saturating_mul(multiplier)
        .min(RECONNECT_MAX_DELAY.as_secs().saturating_mul(1_000));
    let jitter_basis_points = jitter_basis_points.clamp(
        -RECONNECT_JITTER_BASIS_POINTS,
        RECONNECT_JITTER_BASIS_POINTS,
    );
    let adjustment =
        base_millis.saturating_mul(u64::from(jitter_basis_points.unsigned_abs())) / 10_000;
    let jittered_millis = if jitter_basis_points.is_negative() {
        base_millis.saturating_sub(adjustment)
    } else {
        base_millis.saturating_add(adjustment)
    };

    Duration::from_millis(jittered_millis.max(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heartbeat_timeout_allows_three_intervals() {
        assert_eq!(HEARTBEAT_TIMEOUT, HEARTBEAT_INTERVAL * 3);
    }

    #[test]
    fn reconnect_delay_is_deterministic_at_jitter_boundaries() {
        assert_eq!(reconnect_delay(0, -2_000), Duration::from_millis(800));
        assert_eq!(reconnect_delay(0, 0), Duration::from_secs(1));
        assert_eq!(reconnect_delay(3, 2_000), Duration::from_millis(9_600));
        assert_eq!(reconnect_delay(10, 2_000), Duration::from_secs(36));
        assert_eq!(reconnect_delay(u32::MAX, 0), RECONNECT_MAX_DELAY);
    }

    #[test]
    fn reconnect_delay_clamps_out_of_range_samples() {
        assert_eq!(reconnect_delay(1, -3_000), Duration::from_millis(1_600));
        assert_eq!(reconnect_delay(1, 3_000), Duration::from_millis(2_400));
    }
}
