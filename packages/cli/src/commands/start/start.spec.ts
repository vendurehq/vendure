import { describe, expect, it } from 'vitest';

import { getStartProcessDefinitions, getStartProcessesForTarget, normalizeStartTarget } from './start';

describe('start command', () => {
    describe('getStartProcessDefinitions()', () => {
        it('uses default compiled entrypoints', () => {
            const definitions = getStartProcessDefinitions();

            expect(definitions.server.args).toEqual(['./dist/index.js']);
            expect(definitions.worker.args).toEqual(['./dist/index-worker.js']);
        });

        it('uses custom compiled entrypoints', () => {
            const definitions = getStartProcessDefinitions({
                serverEntry: './build/server.js',
                workerEntry: './build/worker.js',
            });

            expect(definitions.server.args).toEqual(['./build/server.js']);
            expect(definitions.worker.args).toEqual(['./build/worker.js']);
        });
    });

    describe('getStartProcessesForTarget()', () => {
        it('starts server and worker for all', () => {
            const definitions = getStartProcessDefinitions();

            expect(getStartProcessesForTarget('all', definitions).map(process => process.target)).toEqual([
                'server',
                'worker',
            ]);
        });

        it('starts one target directly when requested', () => {
            const definitions = getStartProcessDefinitions();

            expect(getStartProcessesForTarget('worker', definitions)).toEqual([definitions.worker]);
        });
    });

    describe('normalizeStartTarget()', () => {
        it('defaults to all', () => {
            expect(normalizeStartTarget()).toBe('all');
        });

        it('accepts known targets', () => {
            expect(normalizeStartTarget('all')).toBe('all');
            expect(normalizeStartTarget('server')).toBe('server');
            expect(normalizeStartTarget('worker')).toBe('worker');
        });

        it('rejects unknown targets', () => {
            expect(() => normalizeStartTarget('dashboard')).toThrow('Unknown start target');
        });
    });
});
