import { Pipe, PipeTransform } from '@angular/core';

/**
 * A pipe for sorting elements of an array. Should be used with caution due to the
 * potential for perf degredation. Ideally should only be used on small arrays (< 10s of items)
 * and in components using OnPush change detection.
 */
@Pipe({
    name: 'sort',
    standalone: false,
})
export class SortPipe implements PipeTransform {
    transform<T>(value: T[] | readonly T[], orderByProp?: keyof T) {
        return value.slice().sort((a, b) => {
            const aProp = orderByProp ? a[orderByProp] : a;
            const bProp = orderByProp ? b[orderByProp] : b;
            if (aProp === bProp) {
                return 0;
            }
            if (aProp == null) {
                return 1;
            }
            if (bProp == null) {
                return -1;
            }
            return aProp > bProp ? 1 : -1;
        });
    }
}
