import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
    BatchLogRecordProcessor,
    ConsoleLogRecordExporter,
    SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
// Deep import is intentional: otherwise unwanted code (such as instrumented classes) will get
// loaded too early before the Otel instrumentation has had a chance to do its thing.
import { ENABLE_INSTRUMENTATION_ENV_VAR } from '@vendure/core/dist/common/instrument-decorator';

const traceExporter = new OTLPTraceExporter();
const logExporter = new OTLPLogExporter();

/**
 * @description
 * Options for configuring the OpenTelemetry Node SDK.
 *
 * @docsCategory core plugins/TelemetryPlugin
 * @docsPage getSdkConfiguration
 */
export interface SdkConfigurationOptions {
    /**
     * @description
     * When set to `true`, the SDK will log spans to the console instead of sending them to an
     * exporter. This should just be used for debugging purposes.
     *
     * @default false
     */
    logToConsole?: boolean;
    /**
     * @description
     * The configuration object for the OpenTelemetry Node SDK.
     */
    config: Partial<NodeSDKConfiguration>;
}

/**
 * @description
 * Creates a configuration object for the OpenTelemetry Node SDK. This is used to set up a custom
 * preload script which must be run before the main Vendure server is loaded by means of the
 * Node.js `--require` flag.
 *
 * @example
 * ```ts
 * // instrumentation.ts
 * import { OTLPLogExporter } from '\@opentelemetry/exporter-logs-otlp-proto';
 * import { OTLPTraceExporter } from '\@opentelemetry/exporter-trace-otlp-http';
 * import { BatchLogRecordProcessor } from '\@opentelemetry/sdk-logs';
 * import { NodeSDK } from '\@opentelemetry/sdk-node';
 * import { BatchSpanProcessor } from '\@opentelemetry/sdk-trace-base';
 * import { getSdkConfiguration } from '\@vendure/telemetry-plugin/preload';
 *
 * process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:3100/otlp';
 * process.env.OTEL_LOGS_EXPORTER = 'otlp';
 * process.env.OTEL_RESOURCE_ATTRIBUTES = 'service.name=vendure-dev-server';
 *
 * const traceExporter = new OTLPTraceExporter({
 *     url: 'http://localhost:4318/v1/traces',
 * });
 * const logExporter = new OTLPLogExporter();
 *
 * const config = getSdkConfiguration({
 *     config: {
 *         spanProcessors: [new BatchSpanProcessor(traceExporter)],
 *         logRecordProcessors: [new BatchLogRecordProcessor(logExporter)],
 *     },
 * });
 *
 * const sdk = new NodeSDK(config);
 *
 * sdk.start();
 * ```
 *
 * This would them be run as:
 * ```bash
 * node --require ./dist/instrumentation.js ./dist/server.js
 * ```
 *
 * @docsCategory core plugins/TelemetryPlugin
 * @docsPage getSdkConfiguration
 * @docsWeight 0
 */
export function getSdkConfiguration(options?: SdkConfigurationOptions): Partial<NodeSDKConfiguration> {
    // This environment variable is used to enable instrumentation in the Vendure core code.
    // Without setting this env var, no instrumentation will be applied to any Vendure classes.
    process.env[ENABLE_INSTRUMENTATION_ENV_VAR] = 'true';
    const { spanProcessors, logRecordProcessors, ...rest } = options?.config ?? {};

    const devModeAwareConfig: Partial<NodeSDKConfiguration> = options?.logToConsole
        ? {
              spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
              logRecordProcessors: [new SimpleLogRecordProcessor(new ConsoleLogRecordExporter())],
          }
        : {
              spanProcessors: spanProcessors ?? [new BatchSpanProcessor(traceExporter)],
              logRecordProcessors: logRecordProcessors ?? [new BatchLogRecordProcessor(logExporter)],
          };

    return {
        resource: resourceFromAttributes({
            'service.name': 'vendure',
            'service.namespace': 'vendure',
            'service.environment': process.env.NODE_ENV || 'development',
        }),
        ...devModeAwareConfig,
        contextManager: new AsyncLocalStorageContextManager(),
        instrumentations: [getNodeAutoInstrumentations()],
        ...rest,
    };
}
