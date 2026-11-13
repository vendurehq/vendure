import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SystemInfoCollector } from './system-info.collector';

vi.mock('os');

describe('SystemInfoCollector', () => {
    let collector: SystemInfoCollector;
    let mockOs: typeof import('os');

    beforeEach(async () => {
        vi.resetAllMocks();
        collector = new SystemInfoCollector();
        mockOs = await import('os');
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    describe('collect()', () => {
        it('returns system info with nodeVersion and platform', () => {
            vi.mocked(mockOs.platform).mockReturnValue('linux');
            vi.mocked(mockOs.arch).mockReturnValue('x64');

            const result = collector.collect();

            // Verify nodeVersion comes from process.version
            expect(result.nodeVersion).toBe(process.version);
            // Verify platform combines os.platform() and os.arch()
            expect(result.platform).toBe('linux x64');
        });

        it('does not throw for any platform/arch combination', () => {
            // Test a few combinations to ensure the function is robust
            const combinations = [
                { platform: 'darwin', arch: 'arm64' },
                { platform: 'win32', arch: 'x64' },
                { platform: 'linux', arch: 'ia32' },
            ] as const;

            for (const { platform, arch } of combinations) {
                vi.mocked(mockOs.platform).mockReturnValue(platform);
                vi.mocked(mockOs.arch).mockReturnValue(arch);

                expect(() => collector.collect()).not.toThrow();
            }
        });
    });

    describe('runtime info', () => {
        const originalUserAgent = process.env.npm_config_user_agent;

        beforeEach(() => {
            vi.mocked(mockOs.cpus).mockReturnValue(new Array(8) as any);
            vi.mocked(mockOs.totalmem).mockReturnValue(16 * 2 ** 30);
        });

        afterEach(() => {
            if (originalUserAgent === undefined) {
                delete process.env.npm_config_user_agent;
            } else {
                process.env.npm_config_user_agent = originalUserAgent;
            }
        });

        it('reports runtimeType "node" by default', () => {
            expect(collector.collect().runtime.runtimeType).toBe('node');
        });

        it('reports runtimeType "bun" when process.versions.bun is present', () => {
            const versions = process.versions as Record<string, string>;
            versions.bun = '1.1.0';
            try {
                expect(collector.collect().runtime.runtimeType).toBe('bun');
            } finally {
                delete versions.bun;
            }
        });

        it('reports runtimeType "deno" when process.versions.deno is present', () => {
            const versions = process.versions as Record<string, string>;
            versions.deno = '1.40.0';
            try {
                expect(collector.collect().runtime.runtimeType).toBe('deno');
            } finally {
                delete versions.deno;
            }
        });

        it.each([
            ['npm/10.0.0 node/v20.0.0 linux x64', 'npm'],
            ['pnpm/9.1.0 npm/? node/v20.0.0 linux x64', 'pnpm'],
            ['yarn/1.22.19 npm/? node/v20.0.0 darwin arm64', 'yarn'],
            ['bun/1.1.0 npm/? node/v20.0.0 darwin arm64', 'bun'],
        ])('parses packageManager from user-agent %s', (userAgent, expected) => {
            process.env.npm_config_user_agent = userAgent;
            expect(collector.collect().runtime.packageManager).toBe(expected);
        });

        it('reports packageManager "unknown" when the user-agent is absent', () => {
            delete process.env.npm_config_user_agent;
            expect(collector.collect().runtime.packageManager).toBe('unknown');
        });

        it('reports packageManager "unknown" for an unrecognized user-agent', () => {
            process.env.npm_config_user_agent = 'deno/1.0.0';
            expect(collector.collect().runtime.packageManager).toBe('unknown');
        });

        it('reports tsNode false when the ts-node register instance is absent', () => {
            expect(collector.collect().runtime.tsNode).toBe(false);
        });

        it('reports tsNode true when the ts-node register instance is present', () => {
            const key = Symbol.for('ts-node.register.instance');
            (process as any)[key] = {};
            try {
                expect(collector.collect().runtime.tsNode).toBe(true);
            } finally {
                delete (process as any)[key];
            }
        });

        it('reports cpuCount from os.cpus()', () => {
            expect(collector.collect().runtime.cpuCount).toBe(8);
        });

        it('reports totalMemoryGb rounded to whole gigabytes', () => {
            vi.mocked(mockOs.totalmem).mockReturnValue(15.6 * 2 ** 30);
            expect(collector.collect().runtime.totalMemoryGb).toBe(16);
        });

        it('leaves cpuCount undefined when os.cpus() reports none', () => {
            vi.mocked(mockOs.cpus).mockReturnValue([] as any);
            expect(collector.collect().runtime.cpuCount).toBeUndefined();
        });
    });
});
