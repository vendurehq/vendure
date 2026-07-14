import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProcessContext } from '../process-context/process-context';
import { VENDURE_VERSION } from '../version';

import { ConfigCollector } from './collectors/config.collector';
import { DatabaseCollector } from './collectors/database.collector';
import { DeploymentCollector } from './collectors/deployment.collector';
import { FeaturesCollector } from './collectors/features.collector';
import { InstallationIdCollector } from './collectors/installation-id.collector';
import { PluginCollector } from './collectors/plugin.collector';
import { SystemInfoCollector } from './collectors/system-info.collector';
import { TelemetryService } from './telemetry.service';

vi.mock('./helpers/ci-detector.helper', () => ({
    isCI: vi.fn(),
}));

describe('TelemetryService', () => {
    let service: TelemetryService;
    let mockProcessContext: Record<string, any>;
    let mockInstallationIdCollector: Partial<InstallationIdCollector>;
    let mockSystemInfoCollector: Partial<SystemInfoCollector>;
    let mockDatabaseCollector: Partial<DatabaseCollector>;
    let mockPluginCollector: Partial<PluginCollector>;
    let mockConfigCollector: Partial<ConfigCollector>;
    let mockDeploymentCollector: Partial<DeploymentCollector>;
    let mockFeaturesCollector: Partial<FeaturesCollector>;
    let mockIsCI: ReturnType<typeof vi.fn>;
    let mockFetch: ReturnType<typeof vi.fn>;

    const originalEnv = { ...process.env };

    function createService() {
        return new TelemetryService(
            mockProcessContext as ProcessContext,
            mockInstallationIdCollector as InstallationIdCollector,
            mockSystemInfoCollector as SystemInfoCollector,
            mockDatabaseCollector as DatabaseCollector,
            mockPluginCollector as PluginCollector,
            mockConfigCollector as ConfigCollector,
            mockDeploymentCollector as DeploymentCollector,
            mockFeaturesCollector as FeaturesCollector,
        );
    }

    beforeEach(async () => {
        vi.resetAllMocks();
        vi.useFakeTimers();

        // Setup fetch mock
        mockFetch = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', mockFetch);

        // Setup CI mock
        const ciModule = await import('./helpers/ci-detector.helper.js');
        mockIsCI = vi.mocked(ciModule.isCI);
        mockIsCI.mockReturnValue(false);

        // Clear telemetry env vars
        delete process.env.VENDURE_DISABLE_TELEMETRY;
        delete process.env.NODE_ENV;

        mockProcessContext = {
            isWorker: false,
        };

        mockInstallationIdCollector = {
            collect: vi.fn().mockResolvedValue('test-installation-id'),
        };

        mockSystemInfoCollector = {
            collect: vi.fn().mockReturnValue({
                nodeVersion: 'v20.0.0',
                platform: 'linux x64',
            }),
        };

        mockDatabaseCollector = {
            collect: vi.fn().mockResolvedValue({
                databaseType: 'postgres',
                metrics: {
                    entities: {
                        Product: '1-100',
                        Channel: '1-100',
                        PaymentMethod: '1-100',
                        ShippingMethod: '1-100',
                    },
                    custom: { entityCount: 0 },
                },
            }),
        };

        mockPluginCollector = {
            collect: vi.fn().mockReturnValue({
                npm: ['@vendure/core'],
                customCount: 0,
            }),
        };

        mockConfigCollector = {
            collect: vi.fn().mockReturnValue({
                assetStorageType: 'LocalAssetStorageStrategy',
                jobQueueType: 'InMemoryJobQueueStrategy',
            }),
        };

        mockDeploymentCollector = {
            collect: vi.fn().mockReturnValue({
                containerized: false,
                workerMode: 'integrated',
                serverless: false,
            }),
        };

        mockFeaturesCollector = {
            collect: vi.fn().mockImplementation((_config: any) =>
                Promise.resolve({
                    multiChannel: false,
                    multiVendor: false,
                    multiStockLocation: false,
                    apiKeysEnabled: false,
                    customFieldsInUse: false,
                    scheduledTasks: false,
                }),
            ),
        };

        service = createService();
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        vi.unstubAllGlobals();
        vi.resetAllMocks();
        vi.useRealTimers();
    });

    describe('onApplicationBootstrap()', () => {
        describe('skip conditions', () => {
            it('skips when worker process', async () => {
                mockProcessContext.isWorker = true;
                service = createService();

                service.onApplicationBootstrap();
                await flushPromises();

                expect(mockFetch).not.toHaveBeenCalled();
            });

            it('skips when VENDURE_DISABLE_TELEMETRY=true', async () => {
                process.env.VENDURE_DISABLE_TELEMETRY = 'true';

                service.onApplicationBootstrap();
                await flushPromises();

                expect(mockFetch).not.toHaveBeenCalled();
            });

            it('skips when VENDURE_DISABLE_TELEMETRY=1', async () => {
                process.env.VENDURE_DISABLE_TELEMETRY = '1';

                service.onApplicationBootstrap();
                await flushPromises();

                expect(mockFetch).not.toHaveBeenCalled();
            });

            it('does not skip when VENDURE_DISABLE_TELEMETRY=false', async () => {
                process.env.VENDURE_DISABLE_TELEMETRY = 'false';

                service.onApplicationBootstrap();
                await flushPromises();

                expect(mockFetch).toHaveBeenCalled();
            });

            it('skips in CI environments', async () => {
                mockIsCI.mockReturnValue(true);

                service.onApplicationBootstrap();
                await flushPromises();

                expect(mockFetch).not.toHaveBeenCalled();
            });
        });

        describe('collector invocation', () => {
            it('calls all collectors when telemetry is enabled', async () => {
                service.onApplicationBootstrap();
                await flushPromises();

                expect(mockInstallationIdCollector.collect).toHaveBeenCalled();
                expect(mockSystemInfoCollector.collect).toHaveBeenCalled();
                expect(mockDatabaseCollector.collect).toHaveBeenCalled();
                expect(mockPluginCollector.collect).toHaveBeenCalled();
                expect(mockConfigCollector.collect).toHaveBeenCalled();
                expect(mockDeploymentCollector.collect).toHaveBeenCalled();
                expect(mockFeaturesCollector.collect).toHaveBeenCalled();
            });

            it('does not send telemetry when a required collector fails', async () => {
                mockDatabaseCollector.collect = vi.fn().mockRejectedValue(new Error('DB error'));

                service.onApplicationBootstrap();
                await flushPromises();

                // When databaseCollector rejects, sendTelemetry catches the error
                // and the fetch is never called
                expect(mockFetch).not.toHaveBeenCalled();
                // But the sync collectors that ran before the failure were still called
                expect(mockInstallationIdCollector.collect).toHaveBeenCalled();
            });
        });

        describe('endpoint configuration', () => {
            it('sends payload to default endpoint', async () => {
                service.onApplicationBootstrap();
                await flushPromises();

                expect(mockFetch).toHaveBeenCalledWith(
                    'https://telemetry.vendure.io/api/v1/collect',
                    expect.objectContaining({
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                    }),
                );
            });

            it('always uses the hardcoded telemetry endpoint', async () => {
                service.onApplicationBootstrap();
                await flushPromises();

                expect(mockFetch).toHaveBeenCalledWith(
                    'https://telemetry.vendure.io/api/v1/collect',
                    expect.any(Object),
                );
            });
        });

        describe('payload structure', () => {
            it('sends correct payload with all required fields', async () => {
                service.onApplicationBootstrap();
                await flushPromises();

                const fetchCall = mockFetch.mock.calls[0];
                const body = JSON.parse(fetchCall[1].body);

                expect(body.installationId).toBe('test-installation-id');
                expect(body.nodeVersion).toBe('v20.0.0');
                expect(body.databaseType).toBe('postgres');
                expect(body.platform).toBe('linux x64');
                expect(body.vendureVersion).toBe(VENDURE_VERSION);
            });

            it('includes timestamp as valid ISO string', async () => {
                service.onApplicationBootstrap();
                await flushPromises();

                const fetchCall = mockFetch.mock.calls[0];
                const body = JSON.parse(fetchCall[1].body);

                // Verify it's a valid ISO date string
                const date = new Date(body.timestamp);
                expect(date.toISOString()).toBe(body.timestamp);
            });

            it('includes NODE_ENV as environment field', async () => {
                process.env.NODE_ENV = 'production';

                service.onApplicationBootstrap();
                await flushPromises();

                const fetchCall = mockFetch.mock.calls[0];
                const body = JSON.parse(fetchCall[1].body);

                expect(body.environment).toBe('production');
            });

            it('handles undefined NODE_ENV gracefully', async () => {
                delete process.env.NODE_ENV;

                service.onApplicationBootstrap();
                await flushPromises();

                const fetchCall = mockFetch.mock.calls[0];
                const body = JSON.parse(fetchCall[1].body);

                expect(body.environment).toBeUndefined();
            });

            it('includes features in the payload', async () => {
                service.onApplicationBootstrap();
                await flushPromises();

                const fetchCall = mockFetch.mock.calls[0];
                const body = JSON.parse(fetchCall[1].body);

                expect(body.features).toEqual({
                    multiChannel: false,
                    multiVendor: false,
                    multiStockLocation: false,
                    apiKeysEnabled: false,
                    customFieldsInUse: false,
                    scheduledTasks: false,
                });
            });

            it('populates scale indicator config fields from entity metrics', async () => {
                service.onApplicationBootstrap();
                await flushPromises();

                const fetchCall = mockFetch.mock.calls[0];
                const body = JSON.parse(fetchCall[1].body);

                expect(body.config.channelCount).toBe('1-100');
                expect(body.config.paymentMethodCount).toBe('1-100');
                expect(body.config.shippingMethodCount).toBe('1-100');
            });
        });

        describe('timeout handling', () => {
            it('uses AbortController for timeout', async () => {
                service.onApplicationBootstrap();
                await flushPromises();

                const fetchCall = mockFetch.mock.calls[0];
                expect(fetchCall[1].signal).toBeInstanceOf(AbortSignal);
            });

            it('aborts request after 5 seconds', async () => {
                let abortSignal: AbortSignal | undefined;
                mockFetch.mockImplementation((_url: string, options: { signal: AbortSignal }) => {
                    abortSignal = options.signal;
                    // Return a promise that never resolves (simulating slow network)
                    // eslint-disable-next-line @typescript-eslint/no-empty-function
                    return new Promise(() => {});
                });

                service.onApplicationBootstrap();

                // First, advance past the initial 5-second delay to trigger sendTelemetry
                await vi.advanceTimersByTimeAsync(5000);

                // Then advance past the 5-second abort timeout
                await vi.advanceTimersByTimeAsync(5000);

                expect(abortSignal?.aborted).toBe(true);
            });
        });

        describe('graceful shutdown', () => {
            it('clears the delay timeout on shutdown before telemetry fires', async () => {
                service.onApplicationBootstrap();

                // Shutdown before the 5s delay elapses
                service.onApplicationShutdown();

                // Advance past the delay
                await vi.advanceTimersByTimeAsync(6000);

                expect(mockFetch).not.toHaveBeenCalled();
            });

            it('onApplicationShutdown is safe to call when no timeout is pending', () => {
                expect(() => service.onApplicationShutdown()).not.toThrow();
            });
        });

        describe('error handling', () => {
            it('silently ignores fetch network errors', async () => {
                mockFetch.mockRejectedValue(new Error('Network error'));

                expect(() => service.onApplicationBootstrap()).not.toThrow();
                await flushPromises();
            });

            it('silently ignores collector errors', async () => {
                mockDatabaseCollector.collect = vi.fn().mockRejectedValue(new Error('DB error'));

                expect(() => service.onApplicationBootstrap()).not.toThrow();
                await flushPromises();
            });

            it('silently ignores abort errors', async () => {
                mockFetch.mockImplementation(() => {
                    const error = new Error('The operation was aborted');
                    error.name = 'AbortError';
                    return Promise.reject(error);
                });

                expect(() => service.onApplicationBootstrap()).not.toThrow();
                await flushPromises();
            });
        });

        describe('error paths — individual collector failures', () => {
            it('silently handles installationIdCollector failure', async () => {
                mockInstallationIdCollector.collect = vi.fn().mockRejectedValue(new Error('ID error'));
                service.onApplicationBootstrap();
                await flushPromises();
                expect(mockFetch).not.toHaveBeenCalled();
            });

            it('silently handles systemInfoCollector failure', async () => {
                mockSystemInfoCollector.collect = vi.fn().mockImplementation(() => {
                    throw new Error('System error');
                });
                service.onApplicationBootstrap();
                await flushPromises();
                expect(mockFetch).not.toHaveBeenCalled();
            });

            it('silently handles pluginCollector failure', async () => {
                mockPluginCollector.collect = vi.fn().mockImplementation(() => {
                    throw new Error('Plugin error');
                });
                service.onApplicationBootstrap();
                await flushPromises();
                expect(mockFetch).not.toHaveBeenCalled();
            });

            it('silently handles configCollector failure', async () => {
                mockConfigCollector.collect = vi.fn().mockImplementation(() => {
                    throw new Error('Config error');
                });
                service.onApplicationBootstrap();
                await flushPromises();
                expect(mockFetch).not.toHaveBeenCalled();
            });

            it('silently handles deploymentCollector failure', async () => {
                mockDeploymentCollector.collect = vi.fn().mockImplementation(() => {
                    throw new Error('Deployment error');
                });
                service.onApplicationBootstrap();
                await flushPromises();
                expect(mockFetch).not.toHaveBeenCalled();
            });

            it('silently handles featuresCollector failure', async () => {
                mockFeaturesCollector.collect = vi.fn().mockRejectedValue(new Error('Features error'));
                service.onApplicationBootstrap();
                await flushPromises();
                expect(mockFetch).not.toHaveBeenCalled();
            });

            it('silently handles databaseCollector failure', async () => {
                mockDatabaseCollector.collect = vi.fn().mockRejectedValue(new Error('DB error'));
                service.onApplicationBootstrap();
                await flushPromises();
                expect(mockFetch).not.toHaveBeenCalled();
            });

            it('handles databaseInfo with missing metrics gracefully', async () => {
                mockDatabaseCollector.collect = vi.fn().mockResolvedValue({
                    databaseType: 'postgres',
                });
                service.onApplicationBootstrap();
                await flushPromises();
                expect(mockFetch).toHaveBeenCalled();
                const body = JSON.parse(mockFetch.mock.calls[0][1].body);
                expect(body.databaseType).toBe('postgres');
                expect(body.metrics).toBeUndefined();
            });

            it('handles databaseInfo with missing entities gracefully', async () => {
                mockDatabaseCollector.collect = vi.fn().mockResolvedValue({
                    databaseType: 'postgres',
                    metrics: { custom: { entityCount: 0 } },
                });
                service.onApplicationBootstrap();
                await flushPromises();
                expect(mockFetch).toHaveBeenCalled();
                const body = JSON.parse(mockFetch.mock.calls[0][1].body);
                expect(body.config.channelCount).toBeUndefined();
            });

            it('handles systemInfoCollector returning empty object', async () => {
                mockSystemInfoCollector.collect = vi.fn().mockReturnValue({});
                service.onApplicationBootstrap();
                await flushPromises();
                expect(mockFetch).toHaveBeenCalled();
                const body = JSON.parse(mockFetch.mock.calls[0][1].body);
                expect(body.nodeVersion).toBeUndefined();
                expect(body.platform).toBeUndefined();
            });

            it('silently swallows non-OK fetch responses (500)', async () => {
                mockFetch.mockResolvedValue({ ok: false, status: 500 });
                service.onApplicationBootstrap();
                await flushPromises();
                // No error thrown — the 500 is silently ignored
                expect(mockFetch).toHaveBeenCalled();
            });

            it('silently swallows non-OK fetch responses (403)', async () => {
                mockFetch.mockResolvedValue({ ok: false, status: 403 });
                service.onApplicationBootstrap();
                await flushPromises();
                // No error thrown — the 403 is silently ignored
                expect(mockFetch).toHaveBeenCalled();
            });

            it('handles double onApplicationBootstrap call without error', async () => {
                service.onApplicationBootstrap();
                service.onApplicationBootstrap();
                await flushPromises();
                // At least one fetch call should succeed
                expect(mockFetch).toHaveBeenCalled();
            });

            it('onApplicationShutdown is safe after telemetry already sent', async () => {
                service.onApplicationBootstrap();
                await flushPromises(); // telemetry fires
                expect(mockFetch).toHaveBeenCalled();
                expect(() => service.onApplicationShutdown()).not.toThrow();
            });
        });
    });
});

async function flushPromises() {
    // Advance timers to trigger the 5-second telemetry delay
    await vi.advanceTimersByTimeAsync(5000);
    // Flush microtasks
    await vi.runAllTimersAsync();
}
