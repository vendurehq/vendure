import { useLingui } from '@lingui/react/macro';
import { Eye, EyeOff } from 'lucide-react';
import * as React from 'react';

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './input-group.js';

type PasswordInputProps = Readonly<Omit<React.ComponentProps<'input'>, 'type'>>;

function PasswordInput({ ...props }: PasswordInputProps) {
    const [showPassword, setShowPassword] = React.useState(false);
    const { t } = useLingui();

    return (
        <InputGroup>
            <InputGroupInput type={showPassword ? 'text' : 'password'} {...props} />
            <InputGroupAddon align="inline-end">
                <InputGroupButton
                    size="icon-xs"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? t`Hide password` : t`Show password`}
                >
                    {showPassword ? <EyeOff /> : <Eye />}
                </InputGroupButton>
            </InputGroupAddon>
        </InputGroup>
    );
}

export { PasswordInput };
