import { INestApplication, INestMicroservice } from '@nestjs/common';

export class TestPluginWithAllLifecycleHooks {
    private static onConstructorFn: any;

    static init(constructorFn: any) {
        this.onConstructorFn = constructorFn;
        return this;
    }

    constructor() {
        TestPluginWithAllLifecycleHooks.onConstructorFn();
    }

    /**
     * This is required because on the first run, the Vendure server will be bootstrapped twice -
     * once to populate the database and the second time for the actual tests. Thus the call counts
     * for the plugin lifecycles will be doubled. This method resets them after the initial
     * (population) run.
     */
    private resetSpies() {
        TestPluginWithAllLifecycleHooks.onConstructorFn.mockClear();
    }
}
