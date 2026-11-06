// weight.rs — Time decay + importance scoring (architecture.md section 6)
//
// Formula: weight = base_weight × decay(age) × reinforcement(votes)
// decay(age) = exp(-age_days × ln(2) / half_life)
// reinforcement = 1 + (upvotes - downvotes) × 0.2

use chrono::{DateTime, Utc};

/// Compute time-decay weight for a single timestamp.
///
/// Arguments:
/// - `created_at`: ISO 8601 timestamp
/// - `half_life_days`: number of days for weight to halve (default: 30)
///
/// Returns weight in range (0.0, 1.0] — recent = close to 1.0, old = close to 0.0.
/// Graduated insights should bypass this (weight = 1.0 always).
pub fn time_decay(created_at: &str, half_life_days: f64) -> f64 {
    let now = Utc::now();
    let parsed = DateTime::parse_from_rfc3339(created_at)
        .map(|value| value.with_timezone(&Utc))
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(created_at, "%Y-%m-%d %H:%M:%S%.f")
                .map(|value| value.and_utc())
        })
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(created_at, "%Y-%m-%dT%H:%M:%S%.f")
                .map(|value| value.and_utc())
        })
        .or_else(|_| {
            chrono::NaiveDate::parse_from_str(created_at, "%Y-%m-%d").map(|value| {
                value
                    .and_hms_opt(0, 0, 0)
                    .expect("valid midnight")
                    .and_utc()
            })
        });
    let Ok(created) = parsed else {
        return 0.0;
    };

    let age_days = (now - created).num_seconds() as f64 / 86400.0;
    if age_days <= 0.0 {
        return 1.0;
    }

    (-age_days * (2.0f64.ln()) / half_life_days).exp()
}

/// Compute reinforcement factor from votes.
///
/// reinforcement = 1 + (upvotes - downvotes) × 0.2
/// Clamped to minimum 0.2 (never fully zero out a voted-down insight).
#[allow(dead_code)]
pub fn reinforcement(importance: i64) -> f64 {
    // importance starts at 2, upvote = +1, downvote = -1
    // So net_votes = importance - 2 (initial)
    let net = importance - 2;
    (1.0 + net as f64 * 0.2).max(0.2)
}

/// Compute combined weight for sorting/ranking.
///
/// weight = time_decay × reinforcement × severity_multiplier
#[allow(dead_code)]
pub fn combined_weight(
    created_at: &str,
    importance: i64,
    severity: &str,
    half_life_days: f64,
) -> f64 {
    let decay = time_decay(created_at, half_life_days);
    let reinforce = reinforcement(importance);
    let severity_mult = match severity {
        "critical" => 4.0,
        "error" => 2.0,
        "warning" => 1.5,
        _ => 1.0,
    };

    decay * reinforce * severity_mult
}

/// Batch compute time-decay weights from JSON timestamps.
/// Input: JSON array of ISO 8601 strings.
/// Output: JSON array of f64 weights.
pub fn batch_compute_json(
    timestamps_json: &str,
    half_life_days: f64,
) -> Result<String, Box<dyn std::error::Error>> {
    if !half_life_days.is_finite() || half_life_days <= 0.0 {
        return Err("Half life must be positive and finite".into());
    }
    let timestamps: Vec<String> = serde_json::from_str(timestamps_json)?;
    let weights: Vec<f64> = timestamps
        .iter()
        .map(|ts| time_decay(ts, half_life_days))
        .collect();
    Ok(serde_json::to_string(&weights)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    const TEST_HALF_LIFE: f64 = 30.0;

    #[test]
    fn test_recent_has_high_weight() {
        let now = Utc::now().to_rfc3339();
        let weight = time_decay(&now, TEST_HALF_LIFE);
        assert!((weight - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_30_days_old_is_half() {
        let thirty_days_ago = (Utc::now() - chrono::Duration::days(30)).to_rfc3339();
        let weight = time_decay(&thirty_days_ago, TEST_HALF_LIFE);
        assert!((weight - 0.5).abs() < 0.01);
    }

    #[test]
    fn test_60_days_old_is_quarter() {
        let sixty_days_ago = (Utc::now() - chrono::Duration::days(60)).to_rfc3339();
        let weight = time_decay(&sixty_days_ago, TEST_HALF_LIFE);
        assert!((weight - 0.25).abs() < 0.01);
    }

    #[test]
    fn test_reinforcement_default() {
        // importance=2 (initial) → net=0 → reinforcement=1.0
        assert!((reinforcement(2) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_reinforcement_upvoted() {
        // importance=5 → net=3 → reinforcement=1.6
        assert!((reinforcement(5) - 1.6).abs() < 1e-6);
    }

    #[test]
    fn test_reinforcement_downvoted_floor() {
        // importance=0 → net=-2 → reinforcement=max(0.6, 0.2)=0.6
        assert!((reinforcement(0) - 0.6).abs() < 1e-6);
    }

    #[test]
    fn test_combined_weight_critical() {
        let now = Utc::now().to_rfc3339();
        let weight = combined_weight(&now, 2, "critical", TEST_HALF_LIFE);
        // time_decay ≈ 1.0, reinforcement = 1.0, severity = 4.0
        assert!((weight - 4.0).abs() < 0.1);
    }

    #[test]
    fn test_batch_compute() {
        let now = Utc::now().to_rfc3339();
        let json = format!("[\"{}\"]", now);
        let result = batch_compute_json(&json, TEST_HALF_LIFE).unwrap();
        let weights: Vec<f64> = serde_json::from_str(&result).unwrap();
        assert_eq!(weights.len(), 1);
        assert!((weights[0] - 1.0).abs() < 0.01);
    }
}
