// vector.rs — Cosine similarity (SIMD-ready vector operations)

/// Compute cosine similarity between two float32 vectors.
/// Uses standard iterator-based approach (auto-vectorized by LLVM with -O3 + LTO).
///
/// Returns value in range [-1.0, 1.0]. Identical vectors → 1.0.
///
/// SIMD note: With `opt-level = 3` and LTO enabled in Cargo.toml,
/// LLVM will auto-vectorize this to SSE/AVX instructions on x86_64.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let mut dot = 0.0f64;
    let mut norm_a = 0.0f64;
    let mut norm_b = 0.0f64;

    for i in 0..a.len() {
        let va = a[i] as f64;
        let vb = b[i] as f64;
        dot += va * vb;
        norm_a += va * va;
        norm_b += vb * vb;
    }

    let denom = (norm_a.sqrt()) * (norm_b.sqrt());
    if denom < 1e-10 {
        return 0.0;
    }

    dot / denom
}

/// JSON interface for napi-rs: parse two JSON arrays, compute cosine similarity.
pub fn cosine_similarity_json(
    vec_a_json: &str,
    vec_b_json: &str,
) -> Result<f64, Box<dyn std::error::Error>> {
    let a: Vec<f32> = serde_json::from_str(vec_a_json)?;
    let b: Vec<f32> = serde_json::from_str(vec_b_json)?;
    Ok(cosine_similarity(&a, &b))
}

/// Batch cosine similarity: one query vector vs multiple candidate vectors.
/// Returns Vec of (index, similarity) sorted by similarity descending.
#[cfg(test)]
pub fn batch_cosine_similarity(query: &[f32], candidates: &[Vec<f32>]) -> Vec<(usize, f64)> {
    let mut results: Vec<(usize, f64)> = candidates
        .iter()
        .enumerate()
        .map(|(i, c)| (i, cosine_similarity(query, c)))
        .collect();

    results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identical_vectors() {
        let a = vec![1.0f32, 2.0, 3.0];
        let result = cosine_similarity(&a, &a);
        assert!((result - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_orthogonal_vectors() {
        let a = vec![1.0f32, 0.0, 0.0];
        let b = vec![0.0f32, 1.0, 0.0];
        let result = cosine_similarity(&a, &b);
        assert!(result.abs() < 1e-6);
    }

    #[test]
    fn test_opposite_vectors() {
        let a = vec![1.0f32, 2.0, 3.0];
        let b = vec![-1.0f32, -2.0, -3.0];
        let result = cosine_similarity(&a, &b);
        assert!((result + 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_empty_vectors() {
        let a: Vec<f32> = vec![];
        let result = cosine_similarity(&a, &a);
        assert_eq!(result, 0.0);
    }

    #[test]
    fn test_json_interface() {
        let a = "[1.0, 0.0, 0.0]";
        let b = "[0.0, 1.0, 0.0]";
        let result = cosine_similarity_json(a, b).unwrap();
        assert!(result.abs() < 1e-6);
    }

    #[test]
    fn test_batch_similarity() {
        let query = vec![1.0f32, 0.0, 0.0];
        let candidates = vec![
            vec![0.0f32, 1.0, 0.0], // orthogonal
            vec![1.0f32, 0.0, 0.0], // identical
            vec![0.5f32, 0.5, 0.0], // partial
        ];
        let results = batch_cosine_similarity(&query, &candidates);
        assert_eq!(results[0].0, 1); // identical is first
    }
}
