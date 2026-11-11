import { Trans, useLingui } from '@lingui/react/macro';
import {
    api,
    Badge,
    Link,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    NativeSelect,
    NativeSelectOption,
    toast,
    useMutation,
    usePermissions,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import { MailIcon } from 'lucide-react';
import { useState } from 'react';

import {
    OrderEmailList,
    OrderEmailPreviewResult,
    orderEmailsQuery,
    OrderEmailTarget,
    previewOrderEmailQuery,
    sendOrderEmailMutation,
} from './email.graphql';

interface Selected {
    type: string;
    label: string;
    target: OrderEmailTarget;
}

/**
 * The Emails block of the order detail page: every order email, what it can be about (the order, a
 * fulfillment, a payment or a refund) and whether the current state allows sending it.
 */
export function OrderEmailsBlock({ context }: Readonly<{ context: { entity?: any } }>) {
    const order = context.entity;
    const orderId: string | undefined = order?.id;
    const [selected, setSelected] = useState<Selected | undefined>();
    const { data, isLoading, error } = useQuery<OrderEmailList>({
        queryKey: ['orderEmails', orderId, order?.state, order?.updatedAt],
        queryFn: () => api.query(orderEmailsQuery, { orderId }),
        enabled: !!orderId,
    });
    if (!orderId) {
        return null;
    }
    if (isLoading) {
        return (
            <div className="text-sm text-muted-foreground">
                <Trans>Loading…</Trans>
            </div>
        );
    }
    if (error || !data) {
        return (
            <div className="text-sm text-destructive">
                <Trans>Could not load emails: {String((error as any)?.message ?? '')}</Trans>
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-3">
            {data.orderEmails.emails.map(email => (
                <EmailRow key={email.type} email={email} onSend={target => setSelected({ type: email.type, label: email.label, target })} />
            ))}
            <Link
                to="/emails"
                search={{ order: order.code }}
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
                <Trans>Preview all email templates</Trans>
            </Link>
            {selected ? (
                <SendEmailDialog
                    orderId={orderId}
                    selected={selected}
                    defaultRecipient={data.orderEmails.recipient ?? ''}
                    onClose={() => setSelected(undefined)}
                />
            ) : null}
        </div>
    );
}

function EmailRow({
    email,
    onSend,
}: Readonly<{
    email: OrderEmailList['orderEmails']['emails'][number];
    onSend: (target: OrderEmailTarget) => void;
}>) {
    const { t } = useLingui();
    const notSendable = (label: string) => t`(not sendable) ${label}`;
    const { hasPermissions } = usePermissions();
    const canSend = hasPermissions(['UpdateOrder']);
    const firstEligible = email.targets.find(candidate => candidate.eligible) ?? email.targets[0];
    const [targetId, setTargetId] = useState<string | undefined>(firstEligible?.id);
    const target = email.targets.find(candidate => candidate.id === targetId) ?? firstEligible;
    // The order itself is the only target of these emails, so its label adds nothing.
    const showSingleTargetLabel =
        email.targets.length === 1 && email.type !== 'order-confirmation' && email.type !== 'order-cancelled';
    return (
        <div className="flex flex-col gap-1 border-b pb-3 last:border-b-0 last:pb-0" data-testid={`order-email-${email.type}`}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{email.label}</span>
                {target ? (
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={!target.eligible || !canSend}
                        onClick={() => onSend(target)}
                    >
                        <MailIcon className="h-3.5 w-3.5" />
                        <Trans>Send</Trans>
                    </Button>
                ) : (
                    <Badge variant="secondary">
                        <Trans>Not applicable</Trans>
                    </Badge>
                )}
            </div>
            {email.targets.length > 1 ? (
                <NativeSelect value={targetId} onChange={e => setTargetId(e.target.value)} className="text-xs">
                    {email.targets.map(option => (
                        <NativeSelectOption key={option.id} value={option.id}>
                            {option.eligible ? option.label : notSendable(option.label)}
                        </NativeSelectOption>
                    ))}
                </NativeSelect>
            ) : null}
            {showSingleTargetLabel ? (
                <span className="text-xs text-muted-foreground">{email.targets[0].label}</span>
            ) : null}
            {email.targets.length ? null : (
                <span className="text-xs text-muted-foreground">
                    <Trans>Nothing in this order to send this email about yet.</Trans>
                </span>
            )}
            {target && !target.eligible && target.reason ? (
                <span className="text-xs text-muted-foreground">{target.reason}</span>
            ) : null}
        </div>
    );
}

function SendEmailDialog({
    orderId,
    selected,
    defaultRecipient,
    onClose,
}: Readonly<{
    orderId: string;
    selected: Selected;
    defaultRecipient: string;
    onClose: () => void;
}>) {
    const { t } = useLingui();
    const queryClient = useQueryClient();
    const [recipient, setRecipient] = useState(defaultRecipient);
    const input = { orderId, type: selected.type, targetId: selected.target.id };
    const preview = useQuery<OrderEmailPreviewResult>({
        queryKey: ['previewOrderEmail', input],
        queryFn: () => api.query(previewOrderEmailQuery, { input }),
    });
    const send = useMutation({
        mutationFn: () => api.mutate(sendOrderEmailMutation, { input: { ...input, recipient } }),
        onSuccess: (result: any) => {
            const to = String(result.sendOrderEmail.recipient);
            const label = selected.label;
            toast.success(t`"${label}" queued for ${to}`);
            void queryClient.invalidateQueries();
            // The worker adds the order history note once it has sent the email.
            setTimeout(() => void queryClient.invalidateQueries(), 3000);
            onClose();
        },
        onError: (err: any) => toast.error(err?.message ?? t`Could not send the email`),
    });
    const email = preview.data?.previewOrderEmail;
    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Send “{selected.label}”</Trans>
                    </DialogTitle>
                    <DialogDescription>{selected.target.label}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3 overflow-auto">
                    <label className="flex flex-col gap-1 text-sm">
                        <Trans>To</Trans>
                        <Input value={recipient} onChange={e => setRecipient(e.target.value)} />
                    </label>
                    <PreviewContent
                        isLoading={preview.isLoading}
                        error={preview.error}
                        subject={email?.subject}
                        html={email?.html}
                    />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        <Trans>Cancel</Trans>
                    </Button>
                    <Button disabled={!recipient || send.isPending || !email} onClick={() => send.mutate()}>
                        {send.isPending ? <Trans>Sending…</Trans> : <Trans>Send email</Trans>}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function PreviewContent({
    isLoading,
    error,
    subject,
    html,
}: Readonly<{ isLoading: boolean; error: unknown; subject?: string; html?: string }>) {
    const { t } = useLingui();
    if (isLoading) {
        return (
            <div className="text-sm text-muted-foreground">
                <Trans>Rendering preview…</Trans>
            </div>
        );
    }
    if (error) {
        return <div className="text-sm text-destructive">{String((error as any)?.message)}</div>;
    }
    if (html == null) {
        return null;
    }
    return (
        <>
            <div className="text-sm">
                <span className="text-muted-foreground">
                    <Trans>Subject:</Trans>{' '}
                </span>
                {subject}
            </div>
            <iframe
                title={t`Email preview`}
                srcDoc={html}
                sandbox=""
                className="w-full h-[50vh] border rounded bg-white"
            />
        </>
    );
}
