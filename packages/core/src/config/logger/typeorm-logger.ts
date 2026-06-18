import { Logger as TypeOrmLoggerInterface, QueryRunner } from 'typeorm';
import { LoggerOptions } from 'typeorm/logger/LoggerOptions';

import { Logger } from './vendure-logger';

const context = 'TypeORM';

type typeOrmLogLevel = Exclude<LoggerOptions, 'all' | boolean>[number];

const defaultLoggerOptions: LoggerOptions = ['error', 'warn', 'schema', 'migration'];

/**
 * A custom logger for TypeORM which delegates to the Vendure Logger service.
 */
export class TypeOrmLogger implements TypeOrmLoggerInterface {
    constructor(private options: LoggerOptions = defaultLoggerOptions) {}

    log(level: 'log' | 'info' | 'warn', message: any, queryRunner?: QueryRunner): any {
        switch (level) {
            case 'info':
                if (this.shouldDisplay('info')) {
                    Logger.info(message, context);
                }
                break;
            case 'log':
                if (this.shouldDisplay('log')) {
                    Logger.info(message, context);
                }
                break;
            case 'warn':
                if (this.shouldDisplay('warn')) {
                    Logger.warn(message, context);
                }
                break;
        }
    }

    logMigration(message: string, queryRunner?: QueryRunner): any {
        Logger.info(message, context);
    }

    logQuery(query: string, parameters?: any[], queryRunner?: QueryRunner): any {
        if (this.shouldDisplay('query')) {
            const sql = this.formatQueryWithParams(query, parameters);
            Logger.debug(`Query: ${sql}`, context);
        }
    }

    logQueryError(error: string, query: string, parameters?: any[], queryRunner?: QueryRunner): any {
        if (this.shouldDisplay('error')) {
            const sql = this.formatQueryWithParams(query, parameters);
            Logger.error(`Query error: ${sql}`, context);
            Logger.verbose(error, context);
        }
    }

    logQuerySlow(time: number, query: string, parameters?: any[], queryRunner?: QueryRunner): any {
        const sql = this.formatQueryWithParams(query, parameters);
        Logger.warn('Query is slow: ' + sql);
        Logger.warn('Execution time: ' + time.toString());
    }

    logSchemaBuild(message: string, queryRunner?: QueryRunner): any {
        if (this.shouldDisplay('schema')) {
            Logger.info(message, context);
        }
    }

    private shouldDisplay(logType: typeOrmLogLevel): boolean {
        return (
            this.options === 'all' ||
            this.options === true ||
            (Array.isArray(this.options) && this.options.includes(logType))
        );
    }

    private formatQueryWithParams(query: string, parameters?: any[]) {
        return (
            query +
            (parameters?.length ? ' -- PARAMETERS: ' + this.stringifyParams(parameters).toString() : '')
        );
    }

    /**
     * Converts parameters to a string.
     * Sometimes parameters can have circular objects and therefor we are handle this case too.
     */
    private stringifyParams(parameters: any[]) {
        try {
            return JSON.stringify(parameters);
        } catch (error) {
            // most probably circular objects in parameters
            return parameters;
        }
    }
}
