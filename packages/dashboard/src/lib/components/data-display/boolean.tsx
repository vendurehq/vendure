import { useLingui } from '@lingui/react/macro';
import { CheckIcon, XIcon } from 'lucide-react';
import React from 'react';
import { StatusBadge } from '../ui/status-badge.js';

export function BooleanDisplayCheckbox({ value }: Readonly<{ value: boolean }>) {
    return value ? <CheckIcon className="opacity-70" /> : <XIcon className="opacity-70" />;
}

export function BooleanDisplayYesNoBadge({ value }: Readonly<{ value: boolean }>) {
    const { t } = useLingui();
    return <StatusBadge tone={value ? 'success' : 'neutral'}>{value ? t`Yes` : t`No`}</StatusBadge>;
}

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
    return (
        <StatusBadge tone={value ? 'success' : 'neutral'}>
            {value ? (labelTrue ?? t`Enabled`) : (labelFalse ?? t`Disabled`)}
        </StatusBadge>
    );
}
