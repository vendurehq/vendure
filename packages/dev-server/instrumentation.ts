import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { getSdkConfiguration } from '@vendure/telemetry-plugin/preload';

process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:3100/otlp';
process.env.OTEL_LOGS_EXPORTER = 'otlp';
process.env.OTEL_RESOURCE_ATTRIBUTES = 'service.name=vendure-dev-server';

const traceExporter = new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces',
});
const logExporter = new OTLPLogExporter();

const config = getSdkConfiguration({
    config: {
        spanProcessors: [new BatchSpanProcessor(traceExporter)],
        logRecordProcessors: [new BatchLogRecordProcessor(logExporter)],
    },
});

const sdk = new NodeSDK(config);

sdk.start();
