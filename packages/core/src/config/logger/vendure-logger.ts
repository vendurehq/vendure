import { LoggerService } from '@nestjs/common';

/**
 * @description
 * An enum of valid logging levels.
 *
 * @docsCategory Logger
 */
export enum LogLevel {
    /**
     * @description
     * Log Errors only. These are usually indicative of some potentially
     * serious issue, so should be acted upon.
     */
    Error = 0,
    /**
     * @description
     * Warnings indicate that some situation may require investigation
     * and handling. But not as serious as an Error.
     */
    Warn = 1,
    /**
     * @description
     * Logs general information such as startup messages.
     */
    Info = 2,
    /**
     * @description
     * Logs additional information
     */
    Verbose = 3,
    /**
     * @description
     * Logs detailed info useful in debug scenarios, including stack traces for
     * all errors. In production this would probably generate too much noise.
     */
    Debug = 4,
}

/**
 * @description
 * Structured data about a log message, passed as the last argument of the {@link VendureLogger}
 * methods. A logger which has no use for it can ignore it.
 *
 * @docsCategory Logger
 * @since 4.0.0
 */
export interface LogMeta {
    /**
     * @description
     * The code of the error which the message reports.
     */
    code?: string;
}

/**
 * @description
 * The VendureLogger interface defines the shape of a logger service which may be provided in
 * the config.
 *
 * Each method takes an optional {@link LogMeta} object as its last argument. To find the request
 * which a message belongs to, a logger can call {@link getRequestId}.
 *
 * @docsCategory Logger
 */
export interface VendureLogger {
    error(message: string, context?: string, trace?: string, meta?: LogMeta): void;
    warn(message: string, context?: string, meta?: LogMeta): void;
    info(message: string, context?: string, meta?: LogMeta): void;
    verbose(message: string, context?: string, meta?: LogMeta): void;
    debug(message: string, context?: string, meta?: LogMeta): void;
    setDefaultContext?(defaultContext: string): void;
}

const noopLogger: VendureLogger = {
    error() {
        /* */
    },
    warn() {
        /* */
    },
    info() {
        /* */
    },
    verbose() {
        /* */
    },
    debug() {
        /* */
    },
};

/**
 * @description
 * The Logger is responsible for all logging in a Vendure application.
 *
 * It is intended to be used as a static class:
 *
 * @example
 * ```ts
 * import { Logger } from '\@vendure/core';
 *
 * Logger.info(`Some log message`, 'My Vendure Plugin');
 * ```
 *
 * The actual implementation - where the logs are written to - is defined by the {@link VendureLogger}
 * instance configured in the {@link VendureConfig}. By default, the {@link DefaultLogger} is used, which
 * logs to the console.
 *
 * ## Implementing a custom logger
 *
 * A custom logger can be passed to the `logger` config option by creating a class which implements the
 * {@link VendureLogger} interface. For example, here is how you might go about implementing a logger which
 * logs to a file:
 *
 * @example
 * ```ts
 * import { VendureLogger } from '\@vendure/core';
 * import fs from 'fs';
 *
 * // A simple custom logger which writes all logs to a file.
 * export class SimpleFileLogger implements VendureLogger {
 *     private logfile: fs.WriteStream;
 *
 *     constructor(logfileLocation: string) {
 *         this.logfile = fs.createWriteStream(logfileLocation, { flags: 'w' });
 *     }
 *
 *     error(message: string, context?: string) {
 *         this.logfile.write(`ERROR: [${context}] ${message}\n`);
 *     }
 *     warn(message: string, context?: string) {
 *         this.logfile.write(`WARN: [${context}] ${message}\n`);
 *     }
 *     info(message: string, context?: string) {
 *         this.logfile.write(`INFO: [${context}] ${message}\n`);
 *     }
 *     verbose(message: string, context?: string) {
 *         this.logfile.write(`VERBOSE: [${context}] ${message}\n`);
 *     }
 *     debug(message: string, context?: string) {
 *         this.logfile.write(`DEBUG: [${context}] ${message}\n`);
 *     }
 * }
 *
 * // in the VendureConfig
 * export const config = {
 *     // ...
 *     logger: new SimpleFileLogger('server.log'),
 * }
 * ```
 *
 * @docsCategory Logger
 */
export class Logger implements LoggerService {
    private static _instance: typeof Logger = Logger;
    private static _logger: VendureLogger;

    static get logger(): VendureLogger {
        return this._logger || noopLogger;
    }

    private get instance(): typeof Logger {
        const { _instance } = Logger;
        return _instance;
    }

    /** @internal */
    static useLogger(logger: VendureLogger) {
        Logger._logger = logger;
    }

    /** @internal */
    error(message: any, trace?: string, context?: string): any {
        // Nestjs ExceptionHandler can't log Error instances properly, so we need to handle them separately.
        if (message instanceof Error) {
            const err = message;
            this.instance.error(err.message, context, err.stack);
        } else {
            this.instance.error(message, context, trace);
        }
    }

    /** @internal */
    warn(message: any, context?: string): any {
        this.instance.warn(message, context);
    }

    /** @internal */
    log(message: any, context?: string): any {
        this.instance.info(message, context);
    }

    /** @internal */
    verbose(message: any, context?: string): any {
        this.instance.verbose(message, context);
    }

    /** @internal */
    debug(message: any, context?: string): any {
        this.instance.debug(message, context);
    }

    static error(message: string, context?: string, trace?: string, meta?: LogMeta): void {
        Logger.logger.error(message, context, trace, meta);
    }

    static warn(message: string, context?: string, meta?: LogMeta): void {
        Logger.logger.warn(message, context, meta);
    }

    static info(message: string, context?: string, meta?: LogMeta): void {
        Logger.logger.info(message, context, meta);
    }

    static verbose(message: string, context?: string, meta?: LogMeta): void {
        Logger.logger.verbose(message, context, meta);
    }

    static debug(message: string, context?: string, meta?: LogMeta): void {
        Logger.logger.debug(message, context, meta);
    }
}
