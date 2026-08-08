type HttpMetric = {
  count: number;
  errors: number;
  durations: number[];
};

type SyncMetric = {
  batches: number;
  objects: number;
  failures: number;
  durations: number[];
};

const MAX_SAMPLES = 1000;

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return Math.round(sorted[index] * 100) / 100;
}

function summary(metric: { count?: number; batches?: number; durations: number[]; errors?: number }) {
  return {
    count: metric.count ?? metric.batches ?? 0,
    errors: metric.errors ?? 0,
    p50Ms: percentile(metric.durations, 50),
    p95Ms: percentile(metric.durations, 95),
    maxMs: metric.durations.length > 0 ? Math.max(...metric.durations) : 0,
  };
}

export class Metrics {
  private http = new Map<string, HttpMetric>();
  private syncBatch: SyncMetric = {
    batches: 0,
    objects: 0,
    failures: 0,
    durations: [],
  };
  private startedAt = new Date();

  recordHttp(route: string, statusCode: number, durationMs: number) {
    const metric = this.http.get(route) ?? {
      count: 0,
      errors: 0,
      durations: [],
    };
    metric.count += 1;
    if (statusCode >= 500) metric.errors += 1;
    metric.durations.push(durationMs);
    if (metric.durations.length > MAX_SAMPLES) metric.durations.shift();
    this.http.set(route, metric);
  }

  recordSyncBatch(objectCount: number, durationMs: number, failed: boolean) {
    this.syncBatch.batches += 1;
    this.syncBatch.objects += objectCount;
    if (failed) this.syncBatch.failures += 1;
    this.syncBatch.durations.push(durationMs);
    if (this.syncBatch.durations.length > MAX_SAMPLES) this.syncBatch.durations.shift();
  }

  snapshot() {
    return {
      startedAt: this.startedAt.toISOString(),
      http: Object.fromEntries(
        [...this.http.entries()].map(([route, metric]) => [route, summary(metric)]),
      ),
      syncBatch: {
        batches: this.syncBatch.batches,
        objects: this.syncBatch.objects,
        failures: this.syncBatch.failures,
        ...summary(this.syncBatch),
      },
    };
  }

  reset() {
    this.http.clear();
    this.syncBatch = { batches: 0, objects: 0, failures: 0, durations: [] };
    this.startedAt = new Date();
  }
}

export const metrics = new Metrics();
