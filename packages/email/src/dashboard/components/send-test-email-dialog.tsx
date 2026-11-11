import { Trans, useLingui } from '@lingui/react/macro';
import {
    api,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    toast,
    useMutation,
} from '@vendure/dashboard';
import { SendIcon } from 'lucide-react';
import { useState } from 'react';

import { EmailDesignValues, sendTestEmailMutation } from '../email.graphql';

const LAST_RECIPIENT_KEY = 'vendure-email-test-recipient';

export interface TestEmailInput {
    type: string;
    label: string;
    languageCode?: string;
    channelCode?: string;
    sampleArgs?: Record<string, string>;
    /** Unsaved text, sent as it is shown. */
    content?: Record<string, string>;
    /** Unsaved design, sent as it is shown. */
    design?: EmailDesignValues;
}

/**
 * A "Send test" button with a dialog that sends the email, with any unsaved changes, to an address,
 * so it can be checked in real email clients.
 */
export function SendTestEmailButton({
    input,
    disabled,
}: Readonly<{ input: TestEmailInput; disabled?: boolean }>) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
                <SendIcon />
                <Trans>Send test</Trans>
            </Button>
            {open ? <SendTestEmailDialog input={input} onClose={() => setOpen(false)} /> : null}
        </>
    );
}

function SendTestEmailDialog({ input, onClose }: Readonly<{ input: TestEmailInput; onClose: () => void }>) {
    const { t } = useLingui();
    const [to, setTo] = useState(() => window.localStorage.getItem(LAST_RECIPIENT_KEY) ?? '');
    const send = useMutation({
        mutationFn: () =>
            api.mutate(sendTestEmailMutation, {
                input: {
                    type: input.type,
                    languageCode: input.languageCode,
                    channelCode: input.channelCode,
                    sampleArgs: input.sampleArgs,
                    content: input.content && Object.keys(input.content).length ? input.content : undefined,
                    design: input.design && Object.keys(input.design).length ? input.design : undefined,
                    to: to.trim(),
                },
            }),
        onSuccess: (result: any) => {
            window.localStorage.setItem(LAST_RECIPIENT_KEY, to.trim());
            toast.success(t`Test email queued for ${result.sendTestEmail.recipient}`);
            onClose();
        },
        onError: (err: any) => toast.error(err?.message ?? t`Could not send the test email`),
    });
    return (
        <Dialog open onOpenChange={open => (open ? undefined : onClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Send a test of "{input.label}"</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Trans>
                            Sends this email, with your unsaved changes, to one address through the configured
                            email transport, so you can check it in Gmail, Outlook or Apple Mail. It uses the
                            same sample data as the preview and has "[Test]" in the subject.
                        </Trans>
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="flex flex-col gap-1.5"
                    onSubmit={e => {
                        e.preventDefault();
                        send.mutate();
                    }}
                >
                    <Label htmlFor="email-test-recipient">
                        <Trans>Send to</Trans>
                    </Label>
                    <Input
                        id="email-test-recipient"
                        type="email"
                        autoFocus
                        placeholder="you@example.com"
                        value={to}
                        onChange={e => setTo(e.target.value)}
                    />
                </form>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        <Trans>Cancel</Trans>
                    </Button>
                    <Button
                        type="button"
                        disabled={!to.trim() || send.isPending}
                        onClick={() => send.mutate()}
                    >
                        {send.isPending ? <Trans>Sending…</Trans> : <Trans>Send test</Trans>}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
