/**
 * Telemetry module for Teams Copilot Agent.
 *
 * Tracks:
 * - Throttling (403/429 from Bot Framework)
 * - Message latencies (end-to-end response time)
 * - Conversation events (new session, resume, expired)
 * - Tool execution metrics
 * - Errors
 *
 * Uses Azure Monitor OpenTelemetry for automatic HTTP/dependency tracking,
 * plus custom metrics and events for bot-specific telemetry.
 */

import { useAzureMonitor } from '@azure/monitor-opentelemetry';
// @ts-ignore - @opentelemetry/api ships JS-only, no .d.ts
import { metrics } from '@opentelemetry/api';

// Initialize Azure Monitor (must be called before other imports use instrumented libs)
const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
if (connectionString) {
    useAzureMonitor({
        azureMonitorExporterOptions: { connectionString },
    });
    console.log('[Telemetry] Azure Monitor initialized');
} else {
    console.log('[Telemetry] No APPLICATIONINSIGHTS_CONNECTION_STRING — telemetry disabled');
}

// ============ Custom Metrics ============

const meter = metrics.getMeter('teams-copilot-agent');

/** Counter: throttle events (403/429) from Bot Framework */
export const throttleCounter = meter.createCounter('bot.throttle.count', {
    description: 'Number of Bot Framework throttle responses (403/429)',
});

/** Counter: messages received from users */
export const messageCounter = meter.createCounter('bot.message.count', {
    description: 'Total messages received from users',
});

/** Histogram: end-to-end message response latency (ms) */
export const responseLatency = meter.createHistogram('bot.response.latency_ms', {
    description: 'End-to-end response latency in ms',
    unit: 'ms',
});

/** Counter: session lifecycle events */
export const sessionCounter = meter.createCounter('bot.session.count', {
    description: 'Session lifecycle events',
});

/** Counter: tool executions */
export const toolCounter = meter.createCounter('bot.tool.count', {
    description: 'Tool execution events',
});

/** Counter: errors */
export const errorCounter = meter.createCounter('bot.error.count', {
    description: 'Error events',
});

/** Histogram: tool execution duration (ms) */
export const toolLatency = meter.createHistogram('bot.tool.latency_ms', {
    description: 'Tool execution latency in ms',
    unit: 'ms',
});

// ============ Tracking Helpers ============

/**
 * Record a throttle event (403 or 429 from Bot Framework).
 */
export function trackThrottle(statusCode: number, operation: string) {
    throttleCounter.add(1, { status_code: statusCode, operation });
}

/**
 * Record a message received and start timing.
 */
export function trackMessageStart(): number {
    messageCounter.add(1);
    return Date.now();
}

/**
 * Record message response completed with latency.
 */
export function trackMessageEnd(startTime: number, success: boolean, turnCount?: number) {
    const latencyMs = Date.now() - startTime;
    responseLatency.record(latencyMs, {
        success: String(success),
        turn_count: String(turnCount ?? 0),
    });
}

/**
 * Record a session lifecycle event.
 */
export function trackSession(event: 'new' | 'resume' | 'expired' | 'ended') {
    sessionCounter.add(1, { event });
}

/**
 * Record a tool execution.
 */
export function trackTool(toolName: string, durationMs: number, success: boolean) {
    toolCounter.add(1, { tool_name: toolName, success: String(success) });
    toolLatency.record(durationMs, { tool_name: toolName, success: String(success) });
}

/**
 * Record an error.
 */
export function trackError(errorType: string, _message?: string) {
    errorCounter.add(1, { error_type: errorType });
}
