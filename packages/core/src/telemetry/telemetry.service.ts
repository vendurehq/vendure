import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { ProcessContext } from '../process-context/process-context';
import { VENDURE_VERSION } from '../version';

import { ConfigCollector } from './collectors/config.collector';
import { DatabaseCollector } from './collectors/database.collector';
import { DeploymentCollector } from './collectors/deployment.collector';
import { FeaturesCollector } from './collectors/features.collector';
import { InstallationIdCollector } from './collectors/installation-id.collector';
import { PluginCollector } from './collectors/plugin.collector';
import { SystemInfoCollector } from './collectors/system-info.collector';
import { isTelemetryDisabled } from './helpers/is-telemetry-disabled.helper';
import { TelemetryPayload } from './telemetry.types';

const TELEMETRY_ENDPOINT = 'https://telemetry.vendure.io/api/v1/collect';
const TELEMETRY_TIMEOUT_MS = 5000;

/**
 * @description
 * The TelemetryService collects anonymous usage data on Vendure application startup
 * and sends it to the Vendure telemetry endpoint. This data helps the Vendure team
 * understand how the framework is being used and prioritize development efforts.
 *
 * **Privacy guarantees:**
 * - Installation ID is a random UUID, not derived from any system information
 * - Custom plugin names are NOT collected (only count)
 * - Entity counts use ranges, not exact numbers
 * - No PII (no hostnames, IPs, user data) is collected
 * - All failures are silently ignored
 *
 * **Opt-out:**
 * Set the environment variable `VENDURE_DISABLE_TELEMETRY=true` to disable telemetry.
 *
 * **CI environments:**
 * Telemetry is automatically disabled in CI environments.
 *
 * @docsCategory Telemetry
 * @since 3.6.0
 */
@Injectable()
export class TelemetryService implements OnApplicationBootstrap, OnApplicationShutdown {
    private delayTimeout: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly processContext: ProcessContext,
        private readonly installationIdCollector: InstallationIdCollector,
        private readonly systemInfoCollector: SystemInfoCollector,
        private readonly databaseCollector: DatabaseCollector,
        private readonly pluginCollector: PluginCollector,
        private readonly configCollector: ConfigCollector,
        private readonly deploymentCollector: DeploymentCollector,
        private readonly featuresCollector: FeaturesCollector,
    ) {}

    onApplicationBootstrap() {
        // Skip if worker process - only run from server
        if (this.processContext.isWorker) {
            return;
        }

        // Skip if disabled or CI environment
        if (isTelemetryDisabled()) {
            return;
        }

        // Delay telemetry collection to allow user bootstrap code to complete
        // This ensures JobQueueService.start() has been called (if it will be)
        // before we check worker mode
        this.delayTimeout = setTimeout(() => {
            this.delayTimeout = undefined;
            this.sendTelemetry().catch(() => {
                // Silently ignore all errors
            });
        }, 5000);
    }

    onApplicationShutdown() {
        if (this.delayTimeout) {
            clearTimeout(this.delayTimeout);
            this.delayTimeout = undefined;
        }
    }

    /**
     * Collects and sends telemetry data.
     */
    private async sendTelemetry(): Promise<void> {
        const payload = await this.collectPayload();
        await this.send(payload);
    }

    /**
     * Collects all telemetry data from the various collectors.
     */
    private async collectPayload(): Promise<TelemetryPayload> {
        const installationId = await this.installationIdCollector.collect();
        const databaseInfo = await this.databaseCollector.collect();

        const systemInfo = this.systemInfoCollector.collect();
        const plugins = this.pluginCollector.collect();
        const collectedConfig = this.configCollector.collect();
        const deployment = this.deploymentCollector.collect();

        // Merge scale indicator counts from already-collected entity metrics
        // into a new object to avoid mutating the collector's return value
        const entities = databaseInfo.metrics?.entities ?? {};
        const config = {
            ...collectedConfig,
            channelCount: entities.Channel ?? collectedConfig.channelCount,
            paymentMethodCount: entities.PaymentMethod ?? collectedConfig.paymentMethodCount,
            shippingMethodCount: entities.ShippingMethod ?? collectedConfig.shippingMethodCount,
        };

        // FeaturesCollector derives flags from already-collected config
        // to avoid duplicating custom-field/scheduler iteration logic
        const features = await this.featuresCollector.collect(config);

        return {
            // Required fields
            installationId,
            timestamp: new Date().toISOString(),
            vendureVersion: VENDURE_VERSION,
            nodeVersion: systemInfo.nodeVersion,
            databaseType: databaseInfo.databaseType,

            // Optional fields
            environment: process.env.NODE_ENV,
            platform: systemInfo.platform,
            plugins,
            metrics: databaseInfo.metrics,
            deployment,
            config,
            features,
        };
    }

    /**
     * Sends the telemetry payload to the collection endpoint.
     * Uses a 5-second timeout to prevent blocking.
     */
    private async send(payload: TelemetryPayload): Promise<void> {
        const endpoint = TELEMETRY_ENDPOINT;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TELEMETRY_TIMEOUT_MS);

        try {
            await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeoutId);
        }
    }
}
