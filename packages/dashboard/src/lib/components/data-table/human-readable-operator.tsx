import { Trans } from '@lingui/react/macro';
import { BOOLEAN_OPERATORS } from './filters/data-table-boolean-filter.js';
import { DATETIME_OPERATORS } from './filters/data-table-datetime-filter.js';
import { ID_OPERATORS } from './filters/data-table-id-filter.js';
import { NUMBER_OPERATORS } from './filters/data-table-number-filter.js';
import { STRING_OPERATORS } from './filters/data-table-string-filter.js';

export type Operator =
    | (typeof DATETIME_OPERATORS)[number]
    | (typeof BOOLEAN_OPERATORS)[number]
    | (typeof ID_OPERATORS)[number]
    | (typeof NUMBER_OPERATORS)[number]
    | (typeof STRING_OPERATORS)[number];

export function HumanReadableOperator({
    operator,
    mode = 'long',
}: {
    operator: Operator;
    mode?: 'short' | 'long';
}) {
    switch (operator) {
        case 'eq':
            return mode === 'short' ? <Trans>=</Trans> : <Trans>is equal to</Trans>;
        case 'notEq':
            return mode === 'short' ? <Trans>!=</Trans> : <Trans>is not equal to</Trans>;
        case 'before':
            return mode === 'short' ? <Trans>before</Trans> : <Trans>is before</Trans>;
        case 'after':
            return mode === 'short' ? <Trans>after</Trans> : <Trans>is after</Trans>;
        case 'between':
            return mode === 'short' ? <Trans>between</Trans> : <Trans>is between</Trans>;
        case 'isNull':
            return <Trans>is null</Trans>;
        case 'in':
            return mode === 'short' ? <Trans>in</Trans> : <Trans>is in</Trans>;
        case 'notIn':
            return mode === 'short' ? <Trans>not in</Trans> : <Trans>is not in</Trans>;
        case 'gt':
            return mode === 'short' ? <Trans>greater than</Trans> : <Trans>is greater than</Trans>;
        case 'gte':
            return mode === 'short' ? (
                <Trans>greater than or equal</Trans>
            ) : (
                <Trans>is greater than or equal to</Trans>
            );
        case 'lt':
            return mode === 'short' ? <Trans>less than</Trans> : <Trans>is less than</Trans>;
        case 'lte':
            return mode === 'short' ? (
                <Trans>less than or equal</Trans>
            ) : (
                <Trans>is less than or equal to</Trans>
            );
        case 'contains':
            return <Trans>contains</Trans>;
        case 'notContains':
            return <Trans>does not contain</Trans>;
        case 'regex':
            return <Trans>matches regex</Trans>;
        default:
            operator satisfies never;
            return <Trans>{operator}</Trans>;
    }
}
