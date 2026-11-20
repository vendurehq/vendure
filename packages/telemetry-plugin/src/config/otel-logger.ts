import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import {
    DefaultLogger,
    getRequestId,
    LogLevel,
    LogMeta,
    VENDURE_VERSION,
    VendureLogger,
} from '@vendure/core';

export const otelLogger = logs.getLogger('@vendure/core', VENDURE_VERSION);

/**
 * @description
 * Options for the OtelLogger.
 *
 * @since 3.3.0
 * @docsCategory core plugins/TelemetryPlugin
 * @docsPage OtelLogger
 */
export interface OtelLoggerOptions {
    /**
     * @description
     * If set to a LogLevel, the logger will also log to the console.
     * This can be useful for local development or debugging.
     *
     * @example
     * ```ts
     * import { LogLevel } from '@vendure/core';
     * import { TelemetryPlugin } from '@vendure/telemetry-plugin';
     *
     * // ...
     *
     * TelemetryPlugin.init({
     *   loggerOptions: {
     *     logToConsole: LogLevel.Verbose,
     *   },
     * });
     * ```
     */
    logToConsole?: LogLevel;
}

/**
 * @description
 * A logger that emits logs to OpenTelemetry and optionally to the console.
 *
 * @since 3.3.0
 * @docsCategory core plugins/TelemetryPlugin
 * @docsPage OtelLogger
 * @docsWeight 0
 */
export class OtelLogger implements VendureLogger {
    private defaultLogger?: DefaultLogger;

    constructor(options: OtelLoggerOptions) {
        if (options.logToConsole) {
            this.defaultLogger = new DefaultLogger({
                level: options.logToConsole,
                timestamp: false,
            });
        }
    }

    debug(message: string, context?: string, meta?: LogMeta): void {
        this.emitLog(SeverityNumber.DEBUG, message, context, meta);
        this.defaultLogger?.debug(message, context, meta);
    }

    warn(message: string, context?: string, meta?: LogMeta): void {
        this.emitLog(SeverityNumber.WARN, message, context, meta);
        this.defaultLogger?.warn(message, context, meta);
    }

    info(message: string, context?: string, meta?: LogMeta): void {
        this.emitLog(SeverityNumber.INFO, message, context, meta);
        this.defaultLogger?.info(message, context, meta);
    }

    error(message: string, context?: string, trace?: string, meta?: LogMeta): void {
        this.emitLog(SeverityNumber.ERROR, message, context, meta, trace);
        this.defaultLogger?.error(message, context, trace, meta);
    }

    verbose(message: string, context?: string, meta?: LogMeta): void {
        this.emitLog(SeverityNumber.DEBUG, message, context, meta);
        this.defaultLogger?.verbose(message, context, meta);
    }

    private emitLog(
        severityNumber: SeverityNumber,
        message: string,
        context?: string,
        meta?: LogMeta,
        trace?: string,
    ): void {
        const requestId = getRequestId();
        otelLogger.emit({
            severityNumber,
            body: message,
            attributes: {
                context,
                service_name: 'vendure',
                ...(meta?.code ? { code: meta.code } : {}),
                ...(requestId ? { request_id: requestId } : {}),
                ...(trace ? { 'exception.stacktrace': trace } : {}),
            },
        });
    }
}
