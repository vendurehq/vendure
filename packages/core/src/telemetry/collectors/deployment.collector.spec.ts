import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../config/config.service';
import { InMemoryJobQueueStrategy } from '../../job-queue/in-memory-job-queue-strategy';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { ProcessContext } from '../../process-context/process-context';

import { CLOUD_PROVIDERS, DeploymentCollector, SERVERLESS_ENV_VARS } from './deployment.collector';

vi.mock('fs');
describe('DeploymentCollector', () => {
    let collector: DeploymentCollector;
    let mockProcessContext: Record<string, any>;
    let mockConfigService: Record<string, any>;
    let mockJobQueueService: Record<string, any>;
    let mockFs: typeof import('fs');

    // Collect all env vars that need to be cleaned (from source of truth)
    const allEnvVarsToClean = [
        'KUBERNETES_SERVICE_HOST',
        ...CLOUD_PROVIDERS.flatMap(p => p.envVars),
        ...SERVERLESS_ENV_VARS,
    ];
    // Deduplicate
    const envVarsToClean = [...new Set(allEnvVarsToClean)];

    const savedEnv: Record<string, string | undefined> = {};

    beforeEach(async () => {
        vi.resetAllMocks();

        // Save and clear relevant env vars
        for (const envVar of envVarsToClean) {
            savedEnv[envVar] = process.env[envVar];
            delete process.env[envVar];
        }

        mockProcessContext = {
            isWorker: false,
        };

        mockConfigService = {
            jobQueueOptions: {
                jobQueueStrategy: new InMemoryJobQueueStrategy(),
                activeQueues: [],
            },
        };

        mockJobQueueService = {
            started: false,
        };

        mockFs = await import('fs');

        collector = new DeploymentCollector(
            mockProcessContext as ProcessContext,
            mockConfigService as ConfigService,
            mockJobQueueService as JobQueueService,
        );
    });

    afterEach(() => {
        // Restore saved env vars
        for (const envVar of envVarsToClean) {
            if (savedEnv[envVar] !== undefined) {
                process.env[envVar] = savedEnv[envVar];
            } else {
                delete process.env[envVar];
            }
        }
        vi.resetAllMocks();
    });

    describe('container detection', () => {
        it('detects Docker via /.dockerenv', () => {
            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                return p === '/.dockerenv';
            });

            const result = collector.collect();

            expect(result.containerized).toBe(true);
        });

        it('detects Kubernetes via KUBERNETES_SERVICE_HOST', () => {
            vi.mocked(mockFs.existsSync).mockReturnValue(false);
            process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';

            const result = collector.collect();

            expect(result.containerized).toBe(true);
        });

        it('detects Docker via /proc/1/cgroup containing "docker"', () => {
            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                return p === '/proc/1/cgroup';
            });
            vi.mocked(mockFs.readFileSync).mockReturnValue('12:memory:/docker/abc123\n');

            const result = collector.collect();

            expect(result.containerized).toBe(true);
        });

        it('detects Kubernetes via /proc/1/cgroup containing "kubepods"', () => {
            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                return p === '/proc/1/cgroup';
            });
            vi.mocked(mockFs.readFileSync).mockReturnValue('12:memory:/kubepods/abc123\n');

            const result = collector.collect();

            expect(result.containerized).toBe(true);
        });

        it('detects containerd via /proc/1/cgroup', () => {
            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                return p === '/proc/1/cgroup';
            });
            vi.mocked(mockFs.readFileSync).mockReturnValue('12:memory:/containerd/abc123\n');

            const result = collector.collect();

            expect(result.containerized).toBe(true);
        });

        it('returns false when not containerized', () => {
            vi.mocked(mockFs.existsSync).mockReturnValue(false);

            const result = collector.collect();

            expect(result.containerized).toBe(false);
        });

        it('handles cgroup read errors gracefully', () => {
            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                return p === '/proc/1/cgroup';
            });
            vi.mocked(mockFs.readFileSync).mockImplementation(() => {
                throw new Error('Permission denied');
            });

            const result = collector.collect();

            expect(result.containerized).toBe(false);
        });

        it('does not detect podman (documents current behavior)', () => {
            // Note: The collector currently only checks for docker, kubepods, and containerd.
            // Podman and other container runtimes are not detected.
            vi.mocked(mockFs.existsSync).mockImplementation((p: any) => {
                return p === '/proc/1/cgroup';
            });
            vi.mocked(mockFs.readFileSync).mockReturnValue('12:memory:/podman/abc123\n');

            const result = collector.collect();

            expect(result.containerized).toBe(false);
        });
    });

    describe('cloud provider detection', () => {
        // Dynamically generate tests from the exported CLOUD_PROVIDERS
        // This ensures tests stay in sync with source
        for (const provider of CLOUD_PROVIDERS) {
            describe(provider.name, () => {
                for (const envVar of provider.envVars) {
                    it(`detects ${provider.name} via ${envVar}`, () => {
                        vi.mocked(mockFs.existsSync).mockReturnValue(false);
                        process.env[envVar] = 'some-value';

                        const result = collector.collect();

                        expect(result.cloudProvider).toBe(provider.name);
                    });
                }
            });
        }

        it('returns undefined when no cloud provider detected', () => {
            vi.mocked(mockFs.existsSync).mockReturnValue(false);

            const result = collector.collect();

            expect(result.cloudProvider).toBeUndefined();
        });

        it('ignores empty string values', () => {
            vi.mocked(mockFs.existsSync).mockReturnValue(false);
            process.env.AWS_REGION = '';

            const result = collector.collect();

            expect(result.cloudProvider).toBeUndefined();
        });

        it('returns first matching provider when multiple are set (order is defined by CLOUD_PROVIDERS array)', () => {
            // Note: This test documents that provider detection order matters.
            // AWS comes before GCP in the CLOUD_PROVIDERS array.
            vi.mocked(mockFs.existsSync).mockReturnValue(false);
            process.env.AWS_REGION = 'us-east-1';
            process.env.GOOGLE_CLOUD_PROJECT = 'my-project';

            const result = collector.collect();

            expect(result.cloudProvider).toBe('aws');
        });
    });

    describe('worker mode', () => {
        it('returns "separate" when worker process', () => {
            mockProcessContext.isWorker = true;
            collector = new DeploymentCollector(
                mockProcessContext as ProcessContext,
                mockConfigService as ConfigService,
                mockJobQueueService as JobQueueService,
            );
            vi.mocked(mockFs.existsSync).mockReturnValue(false);

            const result = collector.collect();

            expect(result.workerMode).toBe('separate');
        });

        it('returns "integrated" when using InMemoryJobQueueStrategy', () => {
            mockProcessContext.isWorker = false;
            mockConfigService.jobQueueOptions = {
                jobQueueStrategy: new InMemoryJobQueueStrategy(),
                activeQueues: [],
            };
            collector = new DeploymentCollector(
                mockProcessContext as ProcessContext,
                mockConfigService as ConfigService,
                mockJobQueueService as JobQueueService,
            );
            vi.mocked(mockFs.existsSync).mockReturnValue(false);

            const result = collector.collect();

            expect(result.workerMode).toBe('integrated');
        });

        it('returns "integrated" when external strategy and job queue started', () => {
            mockProcessContext.isWorker = false;
            mockConfigService.jobQueueOptions = {
                jobQueueStrategy: {}, // Non-InMemory strategy
                activeQueues: [],
            };
            mockJobQueueService.started = true;
            collector = new DeploymentCollector(
                mockProcessContext as ProcessContext,
                mockConfigService as ConfigService,
                mockJobQueueService as JobQueueService,
            );
            vi.mocked(mockFs.existsSync).mockReturnValue(false);

            const result = collector.collect();

            expect(result.workerMode).toBe('integrated');
        });

        it('returns "separate" when external strategy and job queue not started', () => {
            mockProcessContext.isWorker = false;
            mockConfigService.jobQueueOptions = {
                jobQueueStrategy: {}, // Non-InMemory strategy
                activeQueues: [],
            };
            mockJobQueueService.started = false;
            collector = new DeploymentCollector(
                mockProcessContext as ProcessContext,
                mockConfigService as ConfigService,
                mockJobQueueService as JobQueueService,
            );
            vi.mocked(mockFs.existsSync).mockReturnValue(false);

            const result = collector.collect();

            expect(result.workerMode).toBe('separate');
        });
    });

    describe('serverless detection', () => {
        // Dynamically test all serverless env vars from source
        for (const envVar of SERVERLESS_ENV_VARS) {
            it(`detects serverless via ${envVar}`, () => {
                vi.mocked(mockFs.existsSync).mockReturnValue(false);
                process.env[envVar] = 'some-value';

                const result = collector.collect();

                expect(result.serverless).toBe(true);
            });
        }

        it('returns false when not serverless', () => {
            vi.mocked(mockFs.existsSync).mockReturnValue(false);

            const result = collector.collect();

            expect(result.serverless).toBe(false);
        });

        it('ignores empty string values', () => {
            vi.mocked(mockFs.existsSync).mockReturnValue(false);
            process.env.AWS_LAMBDA_FUNCTION_NAME = '';

            const result = collector.collect();

            expect(result.serverless).toBe(false);
        });
    });
});
