/**
 * WP-6.2 — Monitoring & Alerting: Error tracking, performance monitoring, uptime
 * Integrates with Sentry (errors), Datadog (metrics), PagerDuty (on-call alerts)
 */

export interface ErrorReport {
  id: string;
  message: string;
  stack?: string;
  context: {
    userId?: string;
    householdId?: string;
    agentRole?: string;
    tool?: string;
  };
  severity: "low" | "medium" | "high" | "critical";
  timestamp: string;
  resolved?: boolean;
}

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: "ms" | "count" | "percent" | "bytes";
  tags: Record<string, string>;
  timestamp: string;
}

export interface HealthCheck {
  service: string;
  status: "up" | "down" | "degraded";
  responseTimeMs: number;
  lastCheckedAt: string;
  details?: Record<string, unknown>;
}

/**
 * Monitor for application health
 */
export class Monitor {
  private errors: ErrorReport[] = [];
  private metrics: PerformanceMetric[] = [];
  private healthChecks: Map<string, HealthCheck> = new Map();

  /**
   * Report an error
   */
  reportError(
    message: string,
    error: Error,
    context: ErrorReport["context"],
    severity: ErrorReport["severity"] = "medium"
  ): ErrorReport {
    const report: ErrorReport = {
      id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      message,
      stack: error.stack,
      context,
      severity,
      timestamp: new Date().toISOString(),
    };

    this.errors.push(report);

    // Send to error tracking service
    this.sendToSentry(report).catch((err) =>
      console.error("Failed to report error:", err)
    );

    // Alert if critical
    if (severity === "critical") {
      this.alert("CRITICAL ERROR", message, report.id).catch((err) =>
        console.error("Failed to send alert:", err)
      );
    }

    return report;
  }

  /**
   * Track a performance metric
   */
  recordMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);

    // Send to Datadog
    this.sendToDatadog(metric).catch((err) =>
      console.error("Failed to send metric:", err)
    );

    // Alert if threshold exceeded
    if (metric.name === "agent_duration_ms" && metric.value > 5000) {
      this.alert("SLOW AGENT", `${metric.tags.agent} took ${metric.value}ms`);
    }
  }

  /**
   * Check service health
   */
  async checkServiceHealth(service: string): Promise<HealthCheck> {
    const startTime = Date.now();

    try {
      const response = await fetch(`/api/health/${service}`, {
        signal: AbortSignal.timeout(5000),
      });

      const responseTimeMs = Date.now() - startTime;
      const status = response.ok ? "up" : "degraded";

      const health: HealthCheck = {
        service,
        status,
        responseTimeMs,
        lastCheckedAt: new Date().toISOString(),
        details: response.ok ? { statusCode: response.status } : undefined,
      };

      this.healthChecks.set(service, health);

      if (status === "degraded") {
        this.alert("SERVICE DEGRADED", `${service} health check failed`);
      }

      return health;
    } catch (error) {
      const responseTimeMs = Date.now() - startTime;

      const health: HealthCheck = {
        service,
        status: "down",
        responseTimeMs,
        lastCheckedAt: new Date().toISOString(),
        details: { error: String(error) },
      };

      this.healthChecks.set(service, health);

      this.alert("SERVICE DOWN", `${service} health check failed`);

      return health;
    }
  }

  /**
   * Get dashboard summary
   */
  getDashboard(): {
    errorRate: number;
    avgResponseTime: number;
    uptime: number;
    services: HealthCheck[];
    recentErrors: ErrorReport[];
  } {
    const recentErrors = this.errors
      .filter((e) => !e.resolved)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);

    const avgResponseTime =
      this.metrics.length > 0
        ? Math.round(
            this.metrics
              .filter((m) => m.unit === "ms")
              .reduce((sum, m) => sum + m.value, 0) / this.metrics.length
          )
        : 0;

    const services = Array.from(this.healthChecks.values());
    const upServices = services.filter((s) => s.status === "up").length;
    const uptime = services.length > 0 ? Math.round((upServices / services.length) * 100) : 100;

    return {
      errorRate: this.errors.length,
      avgResponseTime,
      uptime,
      services,
      recentErrors,
    };
  }

  /**
   * Get errors by severity
   */
  getErrorsSummary(): {
    critical: number;
    high: number;
    medium: number;
    low: number;
  } {
    const summary = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const error of this.errors) {
      if (!error.resolved) {
        summary[error.severity]++;
      }
    }

    return summary;
  }

  /**
   * Resolve an error
   */
  resolveError(errorId: string): ErrorReport | null {
    const error = this.errors.find((e) => e.id === errorId);
    if (!error) return null;

    error.resolved = true;
    return error;
  }

  /**
   * Private helpers
   */

  private async sendToSentry(report: ErrorReport): Promise<void> {
    try {
      await fetch("https://sentry.io/api/...", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
      });
    } catch (error) {
      console.error("Failed to send to Sentry:", error);
    }
  }

  private async sendToDatadog(metric: PerformanceMetric): Promise<void> {
    try {
      await fetch("https://api.datadoghq.com/api/v1/series", {
        method: "POST",
        headers: {
          "DD-API-KEY": process.env.DATADOG_API_KEY || "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          series: [
            {
              metric: `onetable.${metric.name}`,
              points: [[Date.now() / 1000, metric.value]],
              tags: Object.entries(metric.tags).map(([k, v]) => `${k}:${v}`),
            },
          ],
        }),
      });
    } catch (error) {
      console.error("Failed to send to Datadog:", error);
    }
  }

  private async alert(
    title: string,
    message: string,
    errorId?: string
  ): Promise<void> {
    try {
      await fetch("https://events.pagerduty.com/v2/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routing_key: process.env.PAGERDUTY_KEY,
          event_action: "trigger",
          dedup_key: errorId,
          payload: {
            summary: `${title}: ${message}`,
            severity: "error",
            source: "OneTable",
            timestamp: new Date().toISOString(),
          },
        }),
      });
    } catch (error) {
      console.error("Failed to send PagerDuty alert:", error);
    }
  }
}

/**
 * Singleton instance
 */
export const monitor = new Monitor();

/**
 * Middleware for error tracking
 */
export function errorTrackingMiddleware(
  error: Error,
  context: Partial<ErrorReport["context"]>
): void {
  monitor.reportError(
    error.message,
    error,
    context as ErrorReport["context"],
    "high"
  );
}

/**
 * Performance tracking helper
 */
export function trackPerformance(
  name: string,
  durationMs: number,
  tags: Record<string, string> = {}
): void {
  monitor.recordMetric({
    name,
    value: durationMs,
    unit: "ms",
    tags,
    timestamp: new Date().toISOString(),
  });
}
