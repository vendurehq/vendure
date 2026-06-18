import { CheckIcon, XIcon } from 'lucide-react';
import React from 'react';
import { Badge } from '../ui/badge.js';

export function BooleanDisplayCheckbox({ value }: Readonly<{ value: boolean }>) {
    return value ? <CheckIcon className="opacity-70" /> : <XIcon className="opacity-70" />;
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
    return (
        <Badge variant={value ? 'success' : 'secondary'}>
            {value ? (labelTrue ?? 'Enabled') : (labelFalse ?? 'Disabled')}
        </Badge>
    );
}
