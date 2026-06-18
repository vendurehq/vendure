import { InstrumentationStrategy } from './instrumentation-strategy';

export class NoopInstrumentationStrategy implements InstrumentationStrategy {
    async wrapMethod() {
        // no-op
    }
}
