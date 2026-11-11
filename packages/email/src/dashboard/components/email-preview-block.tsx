import { Trans, useLingui } from '@lingui/react/macro';
import {
    Alert,
    AlertDescription,
    api,
    Badge,
    Button,
    ButtonGroup,
    Input,
    Label,
    NativeSelect,
    NativeSelectOption,
    useChannel,
    useQuery,
} from '@vendure/dashboard';
import { MonitorIcon, RefreshCwIcon, SmartphoneIcon } from 'lucide-react';
import { useState } from 'react';

import { EmailOverviewResult, EmailPreviewResult, previewEmailQuery } from '../email.graphql';

type EmailInfo = EmailOverviewResult['emailOverview']['emails'][number];

const WIDTHS = { desktop: 600, mobile: 375 } as const;

/**
 * Renders the selected email from database data, as the recipient would see it.
 */
export function EmailPreviewBlock({ email, initialOrderCode }: Readonly<{ email: EmailInfo; initialOrderCode?: string }>) {
    const { t } = useLingui();
    const { activeChannel } = useChannel();
    const languages: string[] = activeChannel?.availableLanguageCodes ?? [];
    const [languageCode, setLanguageCode] = useState<string>(activeChannel?.defaultLanguageCode ?? 'en');
    const [orderCode, setOrderCode] = useState(initialOrderCode ?? '');
    const [appliedOrderCode, setAppliedOrderCode] = useState(initialOrderCode ?? '');
    const [width, setWidth] = useState<keyof typeof WIDTHS>('desktop');

    const input = {
        type: email.type,
        languageCode,
        channelCode: activeChannel?.code,
        sampleArgs: email.canSendFromOrder && appliedOrderCode ? { order: appliedOrderCode } : undefined,
    };
    const { data, error, isFetching, refetch } = useQuery<EmailPreviewResult>({
        queryKey: ['previewEmail', input],
        queryFn: () => api.query(previewEmailQuery, { input }),
        retry: false,
    });
    const preview = data?.previewEmail;

    const originLabel = (origin: string) => {
        if (origin === 'package-default') {
            return t`Default template`;
        }
        if (origin === 'project') {
            return t`Project template`;
        }
        if (origin.startsWith('loader:')) {
            const name = origin.slice('loader:'.length);
            return t`Override (${name})`;
        }
        return origin;
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="email-preview-language">
                        <Trans>Language</Trans>
                    </Label>
                    <NativeSelect
                        id="email-preview-language"
                        value={languageCode}
                        onChange={e => setLanguageCode(e.target.value)}
                    >
                        {(languages.length ? languages : [languageCode]).map(code => (
                            <NativeSelectOption key={code} value={code}>
                                {code}
                            </NativeSelectOption>
                        ))}
                    </NativeSelect>
                </div>
                {email.canSendFromOrder ? (
                    <form
                        className="flex flex-col gap-1.5"
                        onSubmit={e => {
                            e.preventDefault();
                            setAppliedOrderCode(orderCode.trim());
                        }}
                    >
                        <Label htmlFor="email-preview-order">
                            <Trans>Order code</Trans>
                        </Label>
                        <Input
                            id="email-preview-order"
                            className="w-56"
                            placeholder={t`Most recent matching order`}
                            value={orderCode}
                            onChange={e => setOrderCode(e.target.value)}
                            onBlur={() => setAppliedOrderCode(orderCode.trim())}
                        />
                    </form>
                ) : null}
                <ButtonGroup className="ml-auto">
                    <Button
                        type="button"
                        variant={width === 'desktop' ? 'default' : 'outline'}
                        onClick={() => setWidth('desktop')}
                        aria-pressed={width === 'desktop'}
                    >
                        <MonitorIcon />
                        <Trans>Desktop</Trans>
                    </Button>
                    <Button
                        type="button"
                        variant={width === 'mobile' ? 'default' : 'outline'}
                        onClick={() => setWidth('mobile')}
                        aria-pressed={width === 'mobile'}
                    >
                        <SmartphoneIcon />
                        <Trans>Mobile</Trans>
                    </Button>
                </ButtonGroup>
                <Button type="button" variant="outline" size="icon" onClick={() => void refetch()} title={t`Refresh`}>
                    <RefreshCwIcon className={isFetching ? 'animate-spin' : undefined} />
                </Button>
            </div>

            {error ? (
                <Alert variant="destructive">
                    <AlertDescription className="whitespace-pre-wrap">
                        {String((error as any)?.message ?? error)}
                    </AlertDescription>
                </Alert>
            ) : null}

            {preview ? (
                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
                    <dt className="text-muted-foreground">
                        <Trans>Subject</Trans>
                    </dt>
                    <dd data-testid="email-preview-subject">{preview.subject}</dd>
                    <dt className="text-muted-foreground">
                        <Trans>From</Trans>
                    </dt>
                    <dd>{preview.from}</dd>
                    <dt className="text-muted-foreground">
                        <Trans>To</Trans>
                    </dt>
                    <dd>{preview.recipient}</dd>
                    <dt className="text-muted-foreground">
                        <Trans>Template</Trans>
                    </dt>
                    <dd>
                        <Badge variant="outline">{originLabel(preview.templateOrigin)}</Badge>
                    </dd>
                </dl>
            ) : null}

            <div className="flex justify-center rounded-lg border bg-muted/40 p-4">
                {preview ? (
                    <iframe
                        title={t`Email preview`}
                        srcDoc={preview.html}
                        sandbox=""
                        className="h-[70vh] rounded-md border bg-white shadow-sm transition-[width]"
                        style={{ width: WIDTHS[width] }}
                    />
                ) : (
                    <div className="flex h-[40vh] items-center text-sm text-muted-foreground">
                        {isFetching ? <Trans>Rendering…</Trans> : <Trans>No preview</Trans>}
                    </div>
                )}
            </div>

            {preview ? (
                <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                        <Trans>Plain text version</Trans>
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-xs">
                        {preview.text}
                    </pre>
                </details>
            ) : null}
        </div>
    );
}
