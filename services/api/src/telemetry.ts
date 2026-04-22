/**
 * Telemetry module for the internal API service.
 *
 * Tracks:
 * - Chat requests (count, latency, TTFT)
 * - Session lifecycle events
 * - Sharing operations
 * - Tool executions
 * - HTTP request metrics
 * - Errors
 */

import { useAzureMonitor } from '@azure/monitor-opentelemetry';
// @ts-ignore
import { metrics } from '@opentelemetry/api';

const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
if (connectionString) {
    useAzureMonitor({
        azureMonitorExporterOptions: { connectionString },
    });
    console.log('[Telemetry] Azure Monitor initialized');
} else {
    console.log('[Telemetry] No APPLICATIONINSIGHTS_CONNECTION_STRING — telemetry disabled');
}

const meter = metrics.getMeter('copilot-api-service');

export const chatCounter = meter.createCounter('api.chat.count', {
    description: 'Chat requests received',
});
export const chatLatency = meter.createHistogram('api.chat.latency_ms', {
    description: 'End-to-end chat request latency',
    unit: 'ms',
});
export const chatFirstTokenLatency = meter.createHistogram('api.chat.first_token_ms', {
    description: 'Time to first SSE token',
    unit: 'ms',
});
export const sessionCounter = meter.createCounter('api.session.count', {
    description: 'Session lifecycle events',
});
export const sessionActive = meter.createUpDownCounter('api.session.active', {
    description: 'Number of currently active sessions',
});
export const shareCounter = meter.createCounter('api.share.count', {
    description: 'Share operations',
});
export const toolCounter = meter.createCounter('api.tool.count', {
    description: 'Tool execution events',
});
export const toolLatency = meter.createHistogram('api.tool.latency_ms', {
    description: 'Tool execution latency',
    unit: 'ms',
});
export const requestCounter = meter.createCounter('api.request.count', {
    description: 'HTTP requests received',
});
export const errorCounter = meter.createCounter('api.error.count', {
    description: 'Error events',
});

// ============ Tracking Helpers ============

export function trackChat(success: boolean) {
    chatCounter.add(1, { success: String(success) });
}
export function trackChatLatency(startTime: number, success: boolean) {
    chatLatency.record(Date.now() - startTime, { success: String(success) });
}
export function trackSession(event: 'create' | 'resume' | 'end' | 'expire') {
    sessionCounter.add(1, { event });
    if (event === 'create' || event === 'resume') {
        sessionActive.add(1);
    } else if (event === 'end' || event === 'expire') {
        sessionActive.add(-1);
    }
}
export function trackShare(action: 'create' | 'revoke' | 'access') {
    shareCounter.add(1, { action });
}
export function trackRequest(method: string, path: string, statusCode: number) {
    requestCounter.add(1, { method, path, status_code: String(statusCode) });
}
export function trackError(errorType: string, route?: string) {
    errorCounter.add(1, { error_type: errorType, route: route ?? 'unknown' });
}
