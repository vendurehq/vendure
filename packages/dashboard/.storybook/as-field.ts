import type { ControllerRenderProps, UseFormRegisterReturn } from 'react-hook-form';

/**
 * Stories pass the result of `register()` to inputs that expect `ControllerRenderProps`.
 * The two types differ only in `value`, so this is a type-only cast.
 */
export function asField(registered: UseFormRegisterReturn): ControllerRenderProps {
    return registered as unknown as ControllerRenderProps;
}
