/**
 * Logger - Pluggable logging for the Copilot Agent Framework.
 *
 * Uses the `debug` package by default (zero output unless DEBUG env var is set).
 * Consumers can inject a custom logger via `setLogger()` or per-class constructor options.
 *
 * Usage:
 *   DEBUG=copilot:*           — enable all logs
 *   DEBUG=copilot:session     — only session manager logs
 *   DEBUG=copilot:audit       — only audit manager logs
 *   DEBUG=copilot:service     — only copilot service logs
 *
 * Custom logger:
 *   import { setLogger } from '@ritwikranjan/copilot-agent-framework';
 *   setLogger({ info: console.log, warn: console.warn, error: console.error, debug: console.debug });
 */

import createDebug from 'debug';

// ============ Logger Interface ============

/**
 * Logger interface that consumers can implement to redirect SDK logs.
 */
export interface ILogger {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}

// ============ Debug-based Default Logger ============

/**
 * Create a logger backed by the `debug` package for a given namespace.
 * Silent by default; enable via DEBUG=copilot:* environment variable.
 */
function createDebugLogger(namespace: string): ILogger {
    const d = createDebug(`copilot:${namespace}`);
    const dWarn = createDebug(`copilot:${namespace}:warn`);
    const dError = createDebug(`copilot:${namespace}:error`);

    return {
        debug: (msg, ...args) => d(msg, ...args),
        info: (msg, ...args) => d(msg, ...args),
        warn: (msg, ...args) => dWarn(msg, ...args),
        error: (msg, ...args) => dError(msg, ...args),
    };
}

// ============ Global Logger Override ============

let _globalLogger: ILogger | null = null;

/**
 * Set a global custom logger for all SDK components.
 * Pass `null` to revert to the default `debug`-based logger.
 *
 * @example
 * ```ts
 * import { setLogger } from '@ritwikranjan/copilot-agent-framework';
 *
 * // Route all SDK logs through your app's logger
 * setLogger({
 *   debug: (msg, ...args) => myLogger.debug(msg, ...args),
 *   info: (msg, ...args) => myLogger.info(msg, ...args),
 *   warn: (msg, ...args) => myLogger.warn(msg, ...args),
 *   error: (msg, ...args) => myLogger.error(msg, ...args),
 * });
 * ```
 */
export function setLogger(logger: ILogger | null): void {
    _globalLogger = logger;
}

/**
 * Get a logger for a given namespace.
 *
 * Resolution order:
 * 1. If a global logger was set via `setLogger()`, use it.
 * 2. Otherwise, create a `debug`-based logger for `copilot:<namespace>`.
 *
 * @param namespace - The component namespace (e.g., 'session', 'audit', 'service')
 */
export function getLogger(namespace: string): ILogger {
    if (_globalLogger) {
        return _globalLogger;
    }
    return createDebugLogger(namespace);
}
