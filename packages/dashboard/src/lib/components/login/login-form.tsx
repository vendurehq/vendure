import { Button } from '@/vdb/components/ui/button.js';
import { Card, CardContent } from '@/vdb/components/ui/card.js';
import { Input } from '@/vdb/components/ui/input.js';
import { PasswordInput } from '@/vdb/components/ui/password-input.js';
import { cn } from '@/vdb/lib/utils.js';
import { z, zodResolver } from '@/vdb/lib/zod.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { Loader2 } from 'lucide-react';
import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from '@/vdb/components/ui/sonner.js';
import { useLoginExtensions } from '../../framework/extension-api/use-login-extensions.js';
import { LogoMark } from '../shared/logo-mark.js';
import { Form } from '../ui/form.js';
import { Field, FieldError } from '../ui/field.js';
import { Separator } from '../ui/separator.js';

export type LoginFormProps = Readonly<
    {
        loginError?: string;
        isVerifying?: boolean;
        onFormSubmit?: (username: string, password: string) => void;
    } & React.ComponentProps<'div'>
>;

const formSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
});

export function LoginForm({ className, onFormSubmit, isVerifying, loginError, ...props }: LoginFormProps) {
    const loginExtensions = useLoginExtensions();
    const { t } = useLingui();

    React.useEffect(() => {
        if (loginError && !isVerifying) {
            toast.error(loginError);
        }
    }, [loginError, isVerifying]);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            username: '',
            password: '',
        },
    });

    return (
        <div className={cn('flex flex-col items-center gap-6', className)} {...props}>
            {loginExtensions.logo ? (
                <loginExtensions.logo.component />
            ) : (
                <LogoMark className="text-primary h-8 w-auto" />
            )}
            <Card className="w-full">
                <CardContent className="pt-6">
                    <Form {...form}>
                        <form
                            className="flex flex-col items-center gap-6"
                            onSubmit={form.handleSubmit(data => onFormSubmit?.(data.username, data.password))}
                        >
                            {loginExtensions.beforeForm ? (
                                <div className="w-full">
                                    <loginExtensions.beforeForm.component />
                                </div>
                            ) : (
                                <div className="flex flex-col items-center text-center gap-2">
                                    <h1 className="text-2xl font-semibold tracking-tight">
                                        <Trans>Welcome to Vendure</Trans>
                                    </h1>
                                    <p className="text-sm text-muted-foreground">
                                        <Trans>Sign in to access the admin dashboard</Trans>
                                    </p>
                                </div>
                            )}
                            <div className="grid gap-4 w-full">
                                <Controller
                                    control={form.control}
                                    name="username"
                                    render={({ field, fieldState }) => (
                                        <Field data-invalid={fieldState.invalid || undefined}>
                                            <Input {...field} id="field-username" placeholder={t`Email`} aria-invalid={fieldState.invalid || undefined} />
                                            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                        </Field>
                                    )}
                                />
                                <Controller
                                    control={form.control}
                                    name="password"
                                    render={({ field, fieldState }) => (
                                        <Field data-invalid={fieldState.invalid || undefined}>
                                            <PasswordInput {...field} id="field-password" placeholder={t`Password`} aria-invalid={fieldState.invalid || undefined} />
                                            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                        </Field>
                                    )}
                                />
                                <Button type="submit" className="w-full" disabled={isVerifying}>
                                    {isVerifying && (
                                        <>
                                            <Loader2 className="animate-spin" />
                                            Please wait
                                        </>
                                    )}
                                    {!isVerifying && <Trans>Sign in</Trans>}
                                </Button>
                            </div>
                            {loginExtensions.afterForm && (
                                <>
                                    <Separator className="w-full" />
                                    <loginExtensions.afterForm.component />
                                </>
                            )}
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
}
