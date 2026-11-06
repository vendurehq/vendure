import { useLingui } from '@lingui/react/macro';
import { CheckIcon, XIcon } from 'lucide-react';
import React from 'react';
import { commonStates, StatusBadge } from '../ui/status-badge.js';

export function BooleanDisplayCheckbox({ value }: Readonly<{ value: boolean }>) {
    return value ? <CheckIcon className="opacity-70" /> : <XIcon className="opacity-70" />;
}

export function BooleanDisplayYesNoBadge({ value }: Readonly<{ value: boolean }>) {
    const { t } = useLingui();
    return <StatusBadge tone={value ? 'success' : 'neutral'}>{value ? t`Yes` : t`No`}</StatusBadge>;
}

/**
 * The normal state is quiet and the exception is loud. A `false` value shows a badge
 * ("Disabled" by default) at all times. A `true` value ("Enabled" by default) shows its badge
 * only while the table row is hovered or holds keyboard focus. At rest the badge is
 * transparent, so it takes no new space when it appears and screen readers still read it.
 */
export function BooleanDisplayBadge({
    value,
    labelTrue,
    labelFalse,
}: {
    value: boolean;
    labelTrue?: string | React.ReactNode;
    labelFalse?: string | React.ReactNode;
}) {
    const { t } = useLingui();
    if (value) {
        return (
            <StatusBadge tone={commonStates.toneFor('enabled')} className={ROW_REVEAL_CLASS}>
                {labelTrue ?? t`Enabled`}
            </StatusBadge>
        );
    }
    return <StatusBadge tone={commonStates.toneFor('disabled')}>{labelFalse ?? t`Disabled`}</StatusBadge>;
}

// Hidden until the table row (`group/row`) is hovered or holds focus.
const ROW_REVEAL_CLASS =
    'opacity-0 transition-opacity duration-fast ease-out group-hover/row:opacity-100 group-focus-within/row:opacity-100 motion-reduce:transition-none';
