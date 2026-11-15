use serde::Serialize;

use super::types::Message;

#[derive(Debug, Default, Serialize)]
pub struct CompletionMetrics {
    pub(super) ttft_ms: Option<f64>,
    pub(super) ttfb_ms: Option<f64>,
    pub(super) e2e_ms: f64,
    pub(super) decode_ms: Option<f64>,
    pub(super) prefill_ms: Option<f64>,
    pub(super) server_decode_ms: Option<f64>,
    pub(super) connection_ms: Option<f64>,
    pub(super) dns_ms: Option<f64>,
    pub(super) tcp_ms: Option<f64>,
    pub(super) tls_ms: Option<f64>,
    pub(super) output_tps: Option<f64>,
    pub(super) tpot_ms: Option<f64>,
    pub(super) itl_mean_ms: Option<f64>,
    pub(super) itl_max_ms: Option<f64>,
    pub(super) itl_stddev_ms: Option<f64>,
    pub(super) chunk_interval_mean_ms: Option<f64>,
    pub(super) chunk_interval_max_ms: Option<f64>,
    pub(super) chunk_interval_stddev_ms: Option<f64>,
    pub(super) input_tokens: Option<u64>,
    pub(super) output_tokens: Option<u64>,
    pub(super) total_tokens: Option<u64>,
    pub(super) cached_tokens: Option<u64>,
    pub(super) reasoning_tokens: Option<u64>,
    pub(super) http_status: Option<u16>,
    pub(super) finish_reason: Option<String>,
    pub(super) timed_out: bool,
}

#[derive(Debug, Default, Serialize)]
pub struct MeasuredCompletion {
    pub(super) message: Option<Message>,
    pub(super) error: Option<String>,
    pub(super) metrics: CompletionMetrics,
}

#[derive(Default)]
pub(super) struct ChunkIntervals {
    pub(super) previous_ms: Option<f64>,
    pub(super) count: u64,
    pub(super) mean: f64,
    pub(super) m2: f64,
    pub(super) max: f64,
}

impl ChunkIntervals {
    pub(super) fn record(&mut self, elapsed_ms: f64) {
        if let Some(previous) = self.previous_ms {
            let interval = elapsed_ms - previous;
            self.count += 1;
            let delta = interval - self.mean;
            self.mean += delta / self.count as f64;
            self.m2 += delta * (interval - self.mean);
            self.max = self.max.max(interval);
        }
        self.previous_ms = Some(elapsed_ms);
    }
}
