import { OrderAddress } from '@vendure/common/lib/generated-types';

import { Address } from '../../../entity/address/address.entity';

/**
 * Given an Address object, this function converts it into a single line
 * consisting of streetLine1, (postalCode), (countryCode).
 */
export function addressToLine(address: Address | OrderAddress): string {
    const propsToInclude: Array<keyof (Address | OrderAddress)> = ['streetLine1', 'postalCode', 'country'];
    let result = address.streetLine1 || '';
    if (address.postalCode) {
        result += ', ' + address.postalCode;
    }
    if (address.country) {
        if (typeof address.country === 'string') {
            result += ', ' + address.country;
        } else {
            result += ', ' + address.country.name;
        }
    }
    return result;
}
