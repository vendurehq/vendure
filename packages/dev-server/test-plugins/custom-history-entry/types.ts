import { CustomerHistoryEntryData } from '@vendure/core';

export const CUSTOM_TYPE = 'CUSTOM_TYPE';

declare module '@vendure/core' {
    interface OrderHistoryEntryData {
        [CUSTOM_TYPE]: { message: string };
    }

    interface CustomerHistoryEntryData {
        [CUSTOM_TYPE]: { name: string };
    }
}
