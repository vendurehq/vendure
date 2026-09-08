import { Button } from '@/vdb/components/ui/button.js';
import { Card, CardContent } from '@/vdb/components/ui/card.js';
import { Input } from '@/vdb/components/ui/input.js';
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

const requestPasswordResetDocument = graphql(`
    mutation RequestPasswordReset($emailAddress: String!) {
        requestPasswordReset(emailAddress: $emailAddress) {
            __typename
            ... on Success {
                success
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

export type ForgotPasswordFormProps = Readonly<React.ComponentProps<'div'>>;

const formSchema = z.object({
    emailAddress: z.string().email(),
});

export function ForgotPasswordForm({ className, ...props }: ForgotPasswordFormProps) {
    const loginExtensions = useLoginExtensions();
    const { t } = useLingui();
    const [submittedEmailAddress, setSubmittedEmailAddress] = React.useState<string | undefined>();

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            emailAddress: '',
        },
    });

    const { mutate: requestPasswordReset, isPending } = useMutation({
        mutationFn: (variables: VariablesOf<typeof requestPasswordResetDocument>) =>
            api.mutate(requestPasswordResetDocument, variables),
        onSuccess: (data, variables) => {
            if (data.requestPasswordReset?.__typename === 'Success') {
                setSubmittedEmailAddress(variables.emailAddress);
            } else {
                toast.error(data.requestPasswordReset?.message ?? t`Something went wrong`, {
                    id: 'forgot-password-error',
                });
            }
        },
        onError: error => {
            toast.error(error.message, { id: 'forgot-password-error' });
        },
    });

    return (
        <div className={cn('flex flex-col items-center gap-6', className)} {...props}>
            {loginExtensions.logo ? (
                <loginExtensions.logo.component />
            ) : (
                <LogoMark className="text-brand h-8 w-auto" />
            )}
            <Card className="w-full">
                <CardContent>
                    {submittedEmailAddress ? (
                        <div className="flex flex-col items-center text-center gap-6">
                            <div className="flex flex-col items-center text-center gap-1">
                                <h1 className="text-2xl font-semibold tracking-tight">
                                    <Trans>Check your email</Trans>
                                </h1>
                                <p className="text-sm text-muted-foreground">
                                    <Trans>
                                        If an account exists for {submittedEmailAddress}, you will receive
                                        an email with a link to reset your password.
                                    </Trans>
                                </p>
                            </div>
                            <Button variant="secondary" className="w-full" render={<Link to="/login" />}>
                                <Trans>Back to sign in</Trans>
                            </Button>
                        </div>
                    ) : (
                        <Form {...form}>
                            <form
                                className="flex flex-col items-center gap-6"
                                onSubmit={form.handleSubmit(data => requestPasswordReset(data))}
                            >
                                <div className="flex flex-col items-center text-center gap-1">
                                    <h1 className="text-2xl font-semibold tracking-tight">
                                        <Trans>Forgot your password?</Trans>
                                    </h1>
                                    <p className="text-sm text-muted-foreground">
                                        <Trans>
                                            Enter your email address and we will send you a link to reset
                                            your password
                                        </Trans>
                                    </p>
                                </div>
                                <div className="grid gap-4 w-full">
                                    <Controller
                                        control={form.control}
                                        name="emailAddress"
                                        render={({ field, fieldState }) => (
                                            <Field data-invalid={fieldState.invalid || undefined}>
                                                <Input
                                                    {...field}
                                                    id="field-email-address"
                                                    placeholder={t`Email`}
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
                                            <Trans>Send reset link</Trans>
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
