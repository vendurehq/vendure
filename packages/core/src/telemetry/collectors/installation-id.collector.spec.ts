import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';

import { InstallationIdCollector } from './installation-id.collector';

vi.mock('fs');
vi.mock('crypto');

describe('InstallationIdCollector', () => {
    let collector: InstallationIdCollector;
    let mockFs: typeof import('fs');
    let mockCrypto: typeof import('crypto');
    let mockSettingsStoreService: {
        register: ReturnType<typeof vi.fn>;
        get: ReturnType<typeof vi.fn>;
        set: ReturnType<typeof vi.fn>;
    };
    let mockConnection: {
        rawConnection: { isInitialized: boolean } | undefined;
    };

    const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
    const NEW_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    beforeEach(async () => {
        vi.resetAllMocks();

        mockSettingsStoreService = {
            register: vi.fn(),
            get: vi.fn(),
            set: vi.fn(),
        };

        mockConnection = {
            rawConnection: { isInitialized: true },
        };

        collector = new InstallationIdCollector(mockSettingsStoreService as any, mockConnection as any);

        mockFs = await import('fs');
        mockCrypto = await import('crypto');

        // Default mock for randomUUID
        vi.mocked(mockCrypto.randomUUID).mockReturnValue(NEW_UUID);
    });

    describe('onModuleInit()', () => {
        it('registers the settings store field', () => {
            collector.onModuleInit();

            expect(mockSettingsStoreService.register).toHaveBeenCalledWith({
                namespace: 'telemetry',
                fields: [{ name: 'installationId', scope: expect.any(Function), readonly: true }],
            });
        });
    });

    describe('collect() - DB primary flow', () => {
        it('returns ID from database when available', async () => {
            mockSettingsStoreService.get.mockResolvedValue(VALID_UUID);

            const result = await collector.collect();

            expect(result).toBe(VALID_UUID);
            expect(mockFs.existsSync).not.toHaveBeenCalled();
            expect(mockFs.readFileSync).not.toHaveBeenCalled();
        });

        it('caches database ID on subsequent calls', async () => {
            mockSettingsStoreService.get.mockResolvedValue(VALID_UUID);

            const result1 = await collector.collect();
            const result2 = await collector.collect();
            const result3 = await collector.collect();

            expect(result1).toBe(VALID_UUID);
            expect(result2).toBe(VALID_UUID);
            expect(result3).toBe(VALID_UUID);
            expect(mockSettingsStoreService.get).toHaveBeenCalledTimes(1);
        });
    });

    describe('collect() - migration flow (filesystem to DB)', () => {
        it('migrates filesystem ID to database', async () => {
            // DB returns nothing
            mockSettingsStoreService.get.mockResolvedValue(undefined);

            // Filesystem has a valid ID
            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                const pathStr = p.toString();
                if (pathStr.includes('node_modules')) return true;
                if (pathStr.includes('.installation-id')) return true;
                return false;
            });
            vi.mocked(mockFs.readFileSync).mockReturnValue(VALID_UUID);

            const result = await collector.collect();

            expect(result).toBe(VALID_UUID);
            // Should save filesystem ID to DB
            expect(mockSettingsStoreService.set).toHaveBeenCalledWith(
                expect.any(RequestContext),
                'telemetry.installationId',
                VALID_UUID,
            );
        });
    });

    describe('collect() - fresh install flow', () => {
        it('generates new UUID and saves to both DB and filesystem', async () => {
            // DB returns nothing
            mockSettingsStoreService.get.mockResolvedValue(undefined);

            // Filesystem has nothing
            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                const pathStr = p.toString();
                if (pathStr.includes('node_modules')) return true;
                if (pathStr.includes('.installation-id')) return false;
                if (pathStr.includes('.vendure')) return true;
                return false;
            });

            const result = await collector.collect();

            expect(result).toBe(NEW_UUID);
            // Should save to DB
            expect(mockSettingsStoreService.set).toHaveBeenCalledWith(
                expect.any(RequestContext),
                'telemetry.installationId',
                NEW_UUID,
            );
            // Should save to filesystem
            expect(mockFs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('.installation-id'),
                NEW_UUID,
                'utf-8',
            );
        });

        it('creates .vendure directory if it does not exist', async () => {
            mockSettingsStoreService.get.mockResolvedValue(undefined);

            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                const pathStr = p.toString();
                if (pathStr.includes('node_modules')) return true;
                if (pathStr.includes('.installation-id')) return false;
                if (pathStr.includes('.vendure')) return false;
                return false;
            });

            await collector.collect();

            expect(mockFs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.vendure'), {
                recursive: true,
            });
        });
    });

    describe('collect() - DB unavailable fallback', () => {
        it('falls back to filesystem when connection is not initialized', async () => {
            mockConnection.rawConnection = { isInitialized: false };

            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                const pathStr = p.toString();
                if (pathStr.includes('node_modules')) return true;
                if (pathStr.includes('.installation-id')) return true;
                return false;
            });
            vi.mocked(mockFs.readFileSync).mockReturnValue(VALID_UUID);

            const result = await collector.collect();

            expect(result).toBe(VALID_UUID);
            expect(mockSettingsStoreService.get).not.toHaveBeenCalled();
        });

        it('falls back to filesystem when rawConnection is undefined', async () => {
            mockConnection.rawConnection = undefined;

            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                const pathStr = p.toString();
                if (pathStr.includes('node_modules')) return true;
                if (pathStr.includes('.installation-id')) return true;
                return false;
            });
            vi.mocked(mockFs.readFileSync).mockReturnValue(VALID_UUID);

            const result = await collector.collect();

            expect(result).toBe(VALID_UUID);
            expect(mockSettingsStoreService.get).not.toHaveBeenCalled();
        });

        it('generates new ID when both DB and filesystem are unavailable', async () => {
            mockConnection.rawConnection = { isInitialized: false };

            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                const pathStr = p.toString();
                if (pathStr.includes('node_modules')) return true;
                if (pathStr.includes('.installation-id')) return false;
                if (pathStr.includes('.vendure')) return true;
                return false;
            });
            vi.mocked(mockFs.writeFileSync).mockImplementation(() => {
                throw new Error('Permission denied');
            });

            const result = await collector.collect();

            expect(result).toBe(NEW_UUID);
        });
    });

    describe('collect() - DB error fallback', () => {
        it('falls back to filesystem when DB query throws', async () => {
            mockSettingsStoreService.get.mockRejectedValue(new Error('DB connection lost'));

            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                const pathStr = p.toString();
                if (pathStr.includes('node_modules')) return true;
                if (pathStr.includes('.installation-id')) return true;
                return false;
            });
            vi.mocked(mockFs.readFileSync).mockReturnValue(VALID_UUID);

            const result = await collector.collect();

            expect(result).toBe(VALID_UUID);
        });

        it('silently ignores DB write errors during migration', async () => {
            mockSettingsStoreService.get.mockResolvedValue(undefined);
            mockSettingsStoreService.set.mockRejectedValue(new Error('DB write failed'));

            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                const pathStr = p.toString();
                if (pathStr.includes('node_modules')) return true;
                if (pathStr.includes('.installation-id')) return true;
                return false;
            });
            vi.mocked(mockFs.readFileSync).mockReturnValue(VALID_UUID);

            const result = await collector.collect();

            // Should still return the filesystem ID despite DB write failure
            expect(result).toBe(VALID_UUID);
        });
    });

    describe('collect() - filesystem fallback behavior', () => {
        beforeEach(() => {
            // DB returns nothing for all filesystem tests
            mockSettingsStoreService.get.mockResolvedValue(undefined);
        });

        it('reads existing valid UUID from file', async () => {
            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                const pathStr = p.toString();
                if (pathStr.includes('node_modules')) return true;
                if (pathStr.includes('.installation-id')) return true;
                return false;
            });
            vi.mocked(mockFs.readFileSync).mockReturnValue(VALID_UUID);

            const result = await collector.collect();

            expect(result).toBe(VALID_UUID);
        });

        it('generates new UUID when file does not exist', async () => {
            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                const pathStr = p.toString();
                if (pathStr.includes('node_modules')) return true;
                if (pathStr.includes('.installation-id')) return false;
                if (pathStr.includes('.vendure')) return true;
                return false;
            });

            const result = await collector.collect();

            expect(result).toBe(NEW_UUID);
            expect(mockFs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('.installation-id'),
                NEW_UUID,
                'utf-8',
            );
        });

        it('regenerates UUID when file contains invalid UUID', async () => {
            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                const pathStr = p.toString();
                if (pathStr.includes('node_modules')) return true;
                if (pathStr.includes('.installation-id')) return true;
                if (pathStr.includes('.vendure')) return true;
                return false;
            });
            vi.mocked(mockFs.readFileSync).mockReturnValue('invalid-uuid-format');

            const result = await collector.collect();

            expect(result).toBe(NEW_UUID);
        });

        it('regenerates UUID when file is empty', async () => {
            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                const pathStr = p.toString();
                if (pathStr.includes('node_modules')) return true;
                if (pathStr.includes('.installation-id')) return true;
                if (pathStr.includes('.vendure')) return true;
                return false;
            });
            vi.mocked(mockFs.readFileSync).mockReturnValue('');

            const result = await collector.collect();

            expect(result).toBe(NEW_UUID);
        });

        it('falls back to ephemeral ID on filesystem read error', async () => {
            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                const pathStr = p.toString();
                if (pathStr.includes('node_modules')) return true;
                if (pathStr.includes('.installation-id')) return true;
                return false;
            });
            vi.mocked(mockFs.readFileSync).mockImplementation(() => {
                throw new Error('Permission denied');
            });

            const result = await collector.collect();

            expect(result).toBe(NEW_UUID);
        });

        it('falls back to ephemeral ID on filesystem write error', async () => {
            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                const pathStr = p.toString();
                if (pathStr.includes('node_modules')) return true;
                if (pathStr.includes('.installation-id')) return false;
                if (pathStr.includes('.vendure')) return true;
                return false;
            });
            vi.mocked(mockFs.writeFileSync).mockImplementation(() => {
                throw new Error('Permission denied');
            });

            const result = await collector.collect();

            // Should still return a UUID even if write fails
            expect(result).toBe(NEW_UUID);
        });

        it('trims whitespace from read UUID', async () => {
            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                const pathStr = p.toString();
                if (pathStr.includes('node_modules')) return true;
                if (pathStr.includes('.installation-id')) return true;
                return false;
            });
            vi.mocked(mockFs.readFileSync).mockReturnValue(`  ${VALID_UUID}  \n`);

            const result = await collector.collect();

            expect(result).toBe(VALID_UUID);
        });
    });

    describe('project root detection', () => {
        beforeEach(() => {
            mockSettingsStoreService.get.mockResolvedValue(undefined);
        });

        it('finds project root via node_modules', async () => {
            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                const pathStr = p.toString();
                if (pathStr.includes('node_modules')) return true;
                if (pathStr.includes('.installation-id')) return true;
                return false;
            });
            vi.mocked(mockFs.readFileSync).mockReturnValue(VALID_UUID);

            await collector.collect();

            expect(mockFs.existsSync).toHaveBeenCalledWith(expect.stringContaining('node_modules'));
        });

        it('falls back to cwd when node_modules not found', async () => {
            const cwd = process.cwd();
            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                const pathStr = p.toString();
                // node_modules not found anywhere
                if (pathStr.includes('node_modules')) return false;
                if (pathStr.includes('.installation-id')) return true;
                return false;
            });
            vi.mocked(mockFs.readFileSync).mockReturnValue(VALID_UUID);

            await collector.collect();

            // Verify the fallback path uses cwd
            expect(mockFs.existsSync).toHaveBeenCalledWith(path.join(cwd, '.vendure', '.installation-id'));
        });

        it('handles traversal from root directory without infinite loop', async () => {
            // Simulate starting from root - the loop should terminate
            // when currentDir === path.dirname(currentDir) (i.e., '/' === '/')
            let callCount = 0;
            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                callCount++;
                // Prevent infinite loop in test - fail after reasonable iterations
                if (callCount > 100) {
                    throw new Error('Infinite loop detected in directory traversal');
                }
                const pathStr = p.toString();
                // node_modules never found
                if (pathStr.includes('node_modules')) return false;
                if (pathStr.includes('.installation-id')) return false;
                if (pathStr.includes('.vendure')) return true;
                return false;
            });

            // Should not throw and should return a UUID
            const result = await collector.collect();

            expect(result).toBe(NEW_UUID);
            // Verify we didn't hit the infinite loop guard
            expect(callCount).toBeLessThan(100);
        });
    });

    describe('UUID validation', () => {
        const validUUIDs = [
            '550e8400-e29b-41d4-a716-446655440000',
            'A550E840-E29B-41D4-A716-446655440000', // uppercase is valid per RFC 4122
            '00000000-0000-0000-0000-000000000000',
            'ffffffff-ffff-ffff-ffff-ffffffffffff',
        ];

        const invalidUUIDs = [
            'not-a-uuid',
            '550e8400-e29b-41d4-a716', // too short
            '550e8400-e29b-41d4-a716-4466554400000', // too long
            '550e8400e29b41d4a716446655440000', // no dashes
            '550e8400-e29b-41d4-a716-44665544000g', // invalid character
            '',
            '   ',
        ];

        for (const uuid of validUUIDs) {
            it(`accepts valid UUID: ${uuid}`, async () => {
                // DB returns the UUID
                const freshCollector = new InstallationIdCollector(
                    mockSettingsStoreService as any,
                    mockConnection as any,
                );
                mockSettingsStoreService.get.mockResolvedValue(uuid);

                const result = await freshCollector.collect();

                expect(result).toBe(uuid);
            });
        }

        for (const uuid of invalidUUIDs) {
            it(`rejects invalid UUID from DB: "${uuid}"`, async () => {
                const freshCollector = new InstallationIdCollector(
                    mockSettingsStoreService as any,
                    mockConnection as any,
                );
                // DB returns invalid UUID
                mockSettingsStoreService.get.mockResolvedValue(uuid);

                // Filesystem also not available
                vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                    const pathStr = p.toString();
                    if (pathStr.includes('node_modules')) return true;
                    if (pathStr.includes('.installation-id')) return false;
                    if (pathStr.includes('.vendure')) return true;
                    return false;
                });

                const result = await freshCollector.collect();

                expect(result).toBe(NEW_UUID);
            });
        }

        for (const uuid of invalidUUIDs) {
            it(`rejects invalid UUID from filesystem: "${uuid}"`, async () => {
                const freshCollector = new InstallationIdCollector(
                    mockSettingsStoreService as any,
                    mockConnection as any,
                );
                // DB returns nothing
                mockSettingsStoreService.get.mockResolvedValue(undefined);

                vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                    const pathStr = p.toString();
                    if (pathStr.includes('node_modules')) return true;
                    if (pathStr.includes('.installation-id')) return true;
                    if (pathStr.includes('.vendure')) return true;
                    return false;
                });
                vi.mocked(mockFs.readFileSync).mockReturnValue(uuid);

                const result = await freshCollector.collect();

                expect(result).toBe(NEW_UUID);
            });
        }
    });
});
