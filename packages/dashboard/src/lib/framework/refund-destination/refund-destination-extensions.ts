import { DashboardRefundDestinationDefinition } from '@/vdb/framework/extension-api/types/index.js';

import { globalRegistry } from '../registry/global-registry.js';

globalRegistry.register('refundDestinations', new Map<string, DashboardRefundDestinationDefinition>());

export function getRefundDestinationExtension(
    code: string,
): DashboardRefundDestinationDefinition | undefined {
    return globalRegistry.get('refundDestinations').get(code);
}
