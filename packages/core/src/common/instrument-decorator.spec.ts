// `default-config` must load before `config-helpers`, as the package entry point does.
import '../config/default-config';

import { afterEach, describe, expect, it } from 'vitest';

import { resetConfig, setConfig } from '../config/config-helpers';
import { composeStrategy } from '../config/strategy-layer/compose-strategy';
import { StrategyLayer } from '../config/strategy-layer/strategy-layer';
import { InstrumentationStrategy } from '../config/system/instrumentation-strategy';
import { NoopInstrumentationStrategy } from '../config/system/noop-instrumentation-strategy';

import { ENABLE_INSTRUMENTATION_ENV_VAR, Instrument } from './instrument-decorator';

describe('@Instrument()', () => {
    afterEach(() => {
        delete process.env[ENABLE_INSTRUMENTATION_ENV_VAR];
        resetConfig();
    });

    it('treats a composed NoopInstrumentationStrategy like the NoopInstrumentationStrategy alone', async () => {
        class InstrumentationLayer extends StrategyLayer.passThrough<InstrumentationStrategy>() {
            static priority = 1;
        }
        process.env[ENABLE_INSTRUMENTATION_ENV_VAR] = 'true';
        @Instrument()
        class InstrumentedService {}

        await setConfig({ systemOptions: { instrumentationStrategy: new NoopInstrumentationStrategy() } });
        expect(() => new InstrumentedService()).toThrow('Please add a TelemetryPlugin to your VendureConfig');

        await setConfig({
            systemOptions: {
                instrumentationStrategy: composeStrategy(
                    InstrumentationLayer,
                    new NoopInstrumentationStrategy(),
                ),
            },
        });
        expect(() => new InstrumentedService()).toThrow('Please add a TelemetryPlugin to your VendureConfig');
    });
});
