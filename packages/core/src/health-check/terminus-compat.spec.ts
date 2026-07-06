import { describe, expect, it } from 'vitest';

import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from './terminus-compat';

class TestIndicator extends HealthIndicator {
    publicGetStatus(key: string, isHealthy: boolean, data?: { [k: string]: unknown }) {
        return this.getStatus(key, isHealthy, data);
    }
}

describe('terminus-compat', () => {
    describe('HealthIndicator.getStatus', () => {
        it('returns up status with no extra data', () => {
            const indicator = new TestIndicator();
            const result = indicator.publicGetStatus('db', true);
            expect(result).toEqual({ db: { status: 'up' } });
        });

        it('returns down status with no extra data', () => {
            const indicator = new TestIndicator();
            const result = indicator.publicGetStatus('db', false);
            expect(result).toEqual({ db: { status: 'down' } });
        });

        it('merges extra diagnostic data into the status object', () => {
            const indicator = new TestIndicator();
            const result = indicator.publicGetStatus('http', false, {
                statusCode: 503,
                message: 'Service Unavailable',
            });
            expect(result).toEqual({
                http: {
                    status: 'down',
                    statusCode: 503,
                    message: 'Service Unavailable',
                },
            });
        });

        it('uses the key argument as the top-level property name', () => {
            const indicator = new TestIndicator();
            const result = indicator.publicGetStatus('any-custom-key', true);
            expect(Object.keys(result)).toEqual(['any-custom-key']);
        });
    });

    describe('HealthCheckError', () => {
        it('is an instance of Error', () => {
            const err = new HealthCheckError('boom', { svc: { status: 'down' } });
            expect(err).toBeInstanceOf(Error);
        });

        it('preserves the message', () => {
            const err = new HealthCheckError('database unreachable', { db: { status: 'down' } });
            expect(err.message).toBe('database unreachable');
        });

        it('exposes the causes payload', () => {
            const causes: HealthIndicatorResult = {
                db: { status: 'down', message: 'timeout' },
            };
            const err = new HealthCheckError('fail', causes);
            expect(err.causes).toEqual(causes);
        });

        it('sets the name property to HealthCheckError', () => {
            const err = new HealthCheckError('x', { svc: { status: 'down' } });
            expect(err.name).toBe('HealthCheckError');
        });

        it('carries the isHealthCheckError discriminator flag set to true', () => {
            const err = new HealthCheckError('x', { svc: { status: 'down' } });
            expect(err.isHealthCheckError).toBe(true);
        });

        it('accepts non-HealthIndicatorResult causes payloads (any-typed)', () => {
            const arbitraryUpstreamError = {
                response: { status: 503, statusText: 'Service Unavailable' },
                code: 'ECONNREFUSED',
            };
            const err = new HealthCheckError('upstream failed', arbitraryUpstreamError);
            expect(err.causes).toBe(arbitraryUpstreamError);
        });
    });

    describe('HealthIndicatorResult generics', () => {
        it('accepts a narrowed key parameter', () => {
            const result: HealthIndicatorResult<'database'> = {
                database: { status: 'up' },
            };
            expect(result.database.status).toBe('up');
        });

        it('accepts a narrowed status parameter', () => {
            const result: HealthIndicatorResult<'database', 'down'> = {
                database: { status: 'down', message: 'timeout' },
            };
            expect(result.database.status).toBe('down');
        });

        it('accepts a narrowed optional-data parameter', () => {
            type DbData = { latencyMs: number };
            const result: HealthIndicatorResult<'database', 'up', DbData> = {
                database: { status: 'up', latencyMs: 12 },
            };
            expect(result.database.latencyMs).toBe(12);
        });
    });
});
