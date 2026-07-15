import { Button } from '@/vdb/components/ui/button.js';
import { Card, CardContent } from '@/vdb/components/ui/card.js';
import { PasswordInput } from '@/vdb/components/ui/password-input.js';
import { toast } from '@/vdb/components/ui/sonner.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql, VariablesOf } from '@/vdb/graphql/graphql.js';
import { cn } from '@/vdb/lib/utils.js';
import { z, zodResolver } from '@/vdb/lib/zod.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';

import { useLoginExtensions } from '../../framework/extension-api/use-login-extensions.js';
import { LogoMark } from '../shared/logo-mark.js';
import { Field, FieldError } from '../ui/field.js';
import { Form } from '../ui/form.js';

const resetPasswordDocument = graphql(`
    mutation ResetPassword($token: String!, $password: String!) {
        resetPassword(token: $token, password: $password) {
            __typename
            ... on CurrentUser {
                id
                identifier
            }
            ... on ErrorResult {
                errorCode
                message
            }
            ... on PasswordValidationError {
                validationErrorMessage
            }
        }
    }
`);

export type ResetPasswordFormProps = Readonly<
    {
        token?: string;
        onSuccess?: (identifier: string, password: string) => void;
    } & React.ComponentProps<'div'>
>;

export function ResetPasswordForm({ className, token, onSuccess, ...props }: ResetPasswordFormProps) {
    const loginExtensions = useLoginExtensions();
    const { t } = useLingui();
    const [tokenError, setTokenError] = React.useState(false);

    const formSchema = React.useMemo(
        () =>
            z
                .object({
                    password: z.string().min(1),
                    confirmPassword: z.string().min(1),
                })
                .refine(data => data.password === data.confirmPassword, {
                    path: ['confirmPassword'],
                    message: t`Passwords do not match`,
                }),
        [t],
    );

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            password: '',
            confirmPassword: '',
        },
    });

    const { mutate: resetPassword, isPending } = useMutation({
        mutationFn: (variables: VariablesOf<typeof resetPasswordDocument>) =>
            api.mutate(resetPasswordDocument, variables),
        onSuccess: (data, variables) => {
            const result = data.resetPassword;
            switch (result?.__typename) {
                case 'CurrentUser':
                    onSuccess?.(result.identifier, variables.password);
                    break;
                case 'PasswordResetTokenInvalidError':
                case 'PasswordResetTokenExpiredError':
                    setTokenError(true);
                    break;
                case 'PasswordValidationError':
                    toast.error(result.validationErrorMessage, { id: 'reset-password-error' });
                    break;
                default:
                    toast.error(result?.message ?? t`Something went wrong`, {
                        id: 'reset-password-error',
                    });
            }
        },
        onError: error => {
            toast.error(error.message, { id: 'reset-password-error' });
        },
    });

    const showTokenError = tokenError || !token;

    return (
        <div className={cn('flex flex-col items-center gap-6', className)} {...props}>
            {loginExtensions.logo ? (
                <loginExtensions.logo.component />
            ) : (
                <LogoMark className="text-brand h-8 w-auto" />
            )}
            <Card className="w-full">
                <CardContent>
                    {showTokenError ? (
                        <div className="flex flex-col items-center text-center gap-6">
                            <div className="flex flex-col items-center text-center gap-1">
                                <h1 className="text-2xl font-semibold tracking-tight">
                                    <Trans>This link is invalid or has expired</Trans>
                                </h1>
                                <p className="text-sm text-muted-foreground">
                                    <Trans>
                                        Password reset links are only valid for a limited time. Request a
                                        new one to reset your password.
                                    </Trans>
                                </p>
                            </div>
                            <Button
                                variant="secondary"
                                className="w-full"
                                render={<Link to="/forgot-password" />}
                            >
                                <Trans>Request a new link</Trans>
                            </Button>
                        </div>
                    ) : (
                        <Form {...form}>
                            <form
                                className="flex flex-col items-center gap-6"
                                onSubmit={form.handleSubmit(data =>
                                    resetPassword({ token, password: data.password }),
                                )}
                            >
                                <div className="flex flex-col items-center text-center gap-1">
                                    <h1 className="text-2xl font-semibold tracking-tight">
                                        <Trans>Reset your password</Trans>
                                    </h1>
                                    <p className="text-sm text-muted-foreground">
                                        <Trans>Choose a new password for your account</Trans>
                                    </p>
                                </div>
                                <div className="grid gap-4 w-full">
                                    <Controller
                                        control={form.control}
                                        name="password"
                                        render={({ field, fieldState }) => (
                                            <Field data-invalid={fieldState.invalid || undefined}>
                                                <PasswordInput
                                                    {...field}
                                                    id="field-password"
                                                    placeholder={t`New password`}
                                                    aria-invalid={fieldState.invalid || undefined}
                                                />
                                                {fieldState.invalid && (
                                                    <FieldError errors={[fieldState.error]} />
                                                )}
                                            </Field>
                                        )}
                                    />
                                    <Controller
                                        control={form.control}
                                        name="confirmPassword"
                                        render={({ field, fieldState }) => (
                                            <Field data-invalid={fieldState.invalid || undefined}>
                                                <PasswordInput
                                                    {...field}
                                                    id="field-confirm-password"
                                                    placeholder={t`Confirm new password`}
                                                    aria-invalid={fieldState.invalid || undefined}
                                                />
                                                {fieldState.invalid && (
                                                    <FieldError errors={[fieldState.error]} />
                                                )}
                                            </Field>
                                        )}
                                    />
                                    <Button type="submit" className="w-full" disabled={isPending}>
                                        {isPending ? (
                                            <>
                                                <Loader2 className="animate-spin" />
                                                <Trans>Please wait</Trans>
                                            </>
                                        ) : (
                                            <Trans>Reset password</Trans>
                                        )}
                                    </Button>
                                </div>
                                <Link
                                    to="/login"
                                    className="text-sm text-muted-foreground hover:text-foreground"
                                >
                                    <Trans>Back to sign in</Trans>
                                </Link>
                            </form>
                        </Form>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
