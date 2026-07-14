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
});
