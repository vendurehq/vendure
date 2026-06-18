import { AdminUiConfig } from '@vendure/common/lib/shared-types';

let vendureUiConfig: AdminUiConfig | undefined;

export async function loadAppConfig(): Promise<void> {
    vendureUiConfig = await fetch('./vendure-ui-config.json').then(res => res.json());
}

export function getAppConfig(): AdminUiConfig {
    if (!vendureUiConfig) {
        throw new Error(`vendure ui config not loaded`);
    }
    return vendureUiConfig;
}
