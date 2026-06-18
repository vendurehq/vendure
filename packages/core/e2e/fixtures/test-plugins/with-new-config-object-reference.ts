import { VendurePlugin } from '@vendure/core';

/**
 * https://github.com/vendurehq/vendure/issues/2906
 */
@VendurePlugin({
    configuration: config => {
        return {
            ...config,
            customFields: {
                ...config.customFields,
                Customer: [
                    {
                        name: 'testField',
                        type: 'string',
                    },
                ],
            },
        };
    },
})
export class WithNewConfigObjectReferencePlugin {}
