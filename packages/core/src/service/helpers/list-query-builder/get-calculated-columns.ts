import { Type } from '@vendure/common/lib/shared-types';

import { CalculatedColumnDefinition, CALCULATED_PROPERTIES } from '../../../common/calculated-decorator';

/**
 * @description
 * Returns calculated columns definitions for the given entity type.
 */
export function getCalculatedColumns(entity: Type<any>) {
    const calculatedColumns: CalculatedColumnDefinition[] = [];
    const prototype = entity.prototype;
    if (prototype.hasOwnProperty(CALCULATED_PROPERTIES)) {
        for (const property of prototype[CALCULATED_PROPERTIES]) {
            calculatedColumns.push(property);
        }
    }
    return calculatedColumns;
}
