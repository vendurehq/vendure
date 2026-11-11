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
    toast,
    useChannel,
    useMutation,
    usePermissions,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import { MonitorIcon, MousePointerClickIcon, RefreshCwIcon, RotateCcwIcon, SmartphoneIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
    EmailContentData,
    emailContentQuery,
    EmailContentScope,
    EmailOverviewResult,
    EmailPreviewResult,
    previewEmailQuery,
    updateEmailContentMutation,
} from '../email.graphql';

import { INLINE_EDITOR_SOURCE, withInlineEditor } from './inline-editor-script';

type EmailInfo = EmailOverviewResult['emailOverview']['emails'][number];

const WIDTHS = { desktop: 600, mobile: 375 } as const;

/** Slots that don't appear in the email body, so they are edited in fields above the preview. */
const FIELD_SLOTS = new Set(['subject', 'preview']);

/**
 * Edits the text of an email inside its preview. Click text in the email to change it. Variables
 * show as `{{ name }}`. The subject and the inbox preview text, which aren't in the body, have fields.
 */
export function EmailEditorBlock({ email, initialOrderCode }: Readonly<{ email: EmailInfo; initialOrderCode?: string }>) {
    const { t } = useLingui();
    const queryClient = useQueryClient();
    const { activeChannel } = useChannel();
    const { hasPermissions } = usePermissions();
    const canEdit = hasPermissions(['UpdateSettings']);
    const languages: string[] = activeChannel?.availableLanguageCodes ?? [];
    const [languageCode, setLanguageCode] = useState<string>(activeChannel?.defaultLanguageCode ?? 'en');
    const [scope, setScope] = useState<EmailContentScope>('ALL_CHANNELS');
    const [orderCode, setOrderCode] = useState(initialOrderCode ?? '');
    const [appliedOrderCode, setAppliedOrderCode] = useState(initialOrderCode ?? '');
    const [width, setWidth] = useState<keyof typeof WIDTHS>('desktop');
    const [values, setValues] = useState<Record<string, string>>({});
    // Bumped when the preview must re-render the body: after saving, discarding or resetting text.
    // Typing in the preview itself doesn't re-render it, so the cursor stays where it is.
    const [previewVersion, setPreviewVersion] = useState(0);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const lastTarget = useRef<{ kind: 'field'; name: string; element: HTMLInputElement } | { kind: 'preview' }>();

    const contentVariables = { type: email.type, languageCode, scope };
    const contentQuery = useQuery<{ emailContent: EmailContentData }>({
        queryKey: ['emailContent', contentVariables],
        queryFn: () => api.query(emailContentQuery, contentVariables),
    });
    const content = contentQuery.data?.emailContent;
    const fields = content?.fields ?? [];
    const stored = useMemo(() => Object.fromEntries(fields.map(f => [f.name, f.value ?? ''])), [content]);

    useEffect(() => {
        setValues(stored);
        setPreviewVersion(v => v + 1);
    }, [stored]);

    const dirtyNames = fields.filter(f => (values[f.name] ?? '') !== (f.value ?? '')).map(f => f.name);
    const draft = Object.fromEntries(dirtyNames.map(name => [name, values[name] ?? '']));
    const draftRef = useRef(draft);
    draftRef.current = draft;

    // The fields re-render the preview after a pause in typing; the body edits don't.
    const fieldDraftKey = JSON.stringify([...FIELD_SLOTS].map(name => draft[name] ?? null));
    const [debouncedFieldKey, setDebouncedFieldKey] = useState(fieldDraftKey);
    useEffect(() => {
        const handle = setTimeout(() => setDebouncedFieldKey(fieldDraftKey), 400);
        return () => clearTimeout(handle);
    }, [fieldDraftKey]);

    const previewBase = {
        type: email.type,
        languageCode,
        channelCode: activeChannel?.code,
        sampleArgs: email.canSendFromOrder && appliedOrderCode ? { order: appliedOrderCode } : undefined,
        editable: canEdit,
    };
    const preview = useQuery<EmailPreviewResult>({
        queryKey: ['previewEmail', previewBase, previewVersion, debouncedFieldKey],
        queryFn: () =>
            api.query(previewEmailQuery, {
                input: { ...previewBase, content: Object.keys(draftRef.current).length ? draftRef.current : undefined },
            }),
        retry: false,
        placeholderData: previous => previous,
    });
    const rendered = preview.data?.previewEmail;
    const srcDoc = useMemo(() => (rendered ? withInlineEditor(rendered.html) : ''), [rendered?.html]);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (event.source !== iframeRef.current?.contentWindow) {
                return;
            }
            const data = event.data as { source?: string; type?: string; slot?: string; text?: string };
            if (data?.source !== INLINE_EDITOR_SOURCE || !data.slot) {
                return;
            }
            if (data.type === 'focus') {
                lastTarget.current = { kind: 'preview' };
            }
            if (data.type === 'input') {
                const slot = data.slot;
                setValues(v => ({ ...v, [slot]: normalize(data.text ?? '') }));
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, []);

    const save = useMutation({
        mutationFn: () =>
            api.mutate(updateEmailContentMutation, {
                input: { type: email.type, languageCode, scope, content: draftRef.current },
            }),
        onSuccess: (result: any) => {
            queryClient.setQueryData(['emailContent', contentVariables], { emailContent: result.updateEmailContent });
            toast.success(t`Email text saved`);
        },
        onError: (err: any) => toast.error(err?.message ?? t`Could not save the email text`),
    });

    const resetToStored = () => {
        setValues(stored);
        setPreviewVersion(v => v + 1);
    };
    const resetToDefault = (name: string) => {
        setValues(v => ({ ...v, [name]: '' }));
        if (!FIELD_SLOTS.has(name)) {
            // Re-render with the draft, so the preview shows the fallback text.
            setTimeout(() => setPreviewVersion(v => v + 1));
        }
    };
    const insertVariable = (name: string) => {
        const target = lastTarget.current;
        if (target?.kind === 'field') {
            const placeholder = `{{ ${name} }}`;
            const current = values[target.name] ?? '';
            const start = target.element.selectionStart ?? current.length;
            const end = target.element.selectionEnd ?? current.length;
            setValues(v => ({ ...v, [target.name]: current.slice(0, start) + placeholder + current.slice(end) }));
            requestAnimationFrame(() => {
                target.element.focus();
                target.element.setSelectionRange(start + placeholder.length, start + placeholder.length);
            });
        } else {
            iframeRef.current?.contentWindow?.postMessage({ source: INLINE_EDITOR_SOURCE, type: 'insert-variable', name }, '*');
        }
    };

    const knownVariables = new Set(content?.variables.map(v => v.name) ?? []);
    const changed = fields.filter(f => (values[f.name] ?? '') !== '');

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="email-language">
                        <Trans>Language</Trans>
                    </Label>
                    <NativeSelect id="email-language" value={languageCode} onChange={e => setLanguageCode(e.target.value)}>
                        {(languages.length ? languages : [languageCode]).map(code => (
                            <NativeSelectOption key={code} value={code}>
                                {code}
                            </NativeSelectOption>
                        ))}
                    </NativeSelect>
                </div>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="email-scope">
                        <Trans>Applies to</Trans>
                    </Label>
                    <NativeSelect
                        id="email-scope"
                        value={scope}
                        onChange={e => setScope(e.target.value as EmailContentScope)}
                    >
                        <NativeSelectOption value="ALL_CHANNELS">{t`All channels`}</NativeSelectOption>
                        <NativeSelectOption value="CHANNEL">
                            {t`This channel only (${activeChannel?.code ?? ''})`}
                        </NativeSelectOption>
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
                        <Label htmlFor="email-order">
                            <Trans>Preview with order</Trans>
                        </Label>
                        <Input
                            id="email-order"
                            className="w-48"
                            placeholder={t`Most recent`}
                            value={orderCode}
                            onChange={e => setOrderCode(e.target.value)}
                            onBlur={() => setAppliedOrderCode(orderCode.trim())}
                        />
                    </form>
                ) : null}
                <div className="ml-auto flex gap-2">
                    <Button type="button" variant="outline" disabled={!dirtyNames.length || save.isPending} onClick={resetToStored}>
                        <Trans>Discard</Trans>
                    </Button>
                    <Button type="button" disabled={!canEdit || !dirtyNames.length || save.isPending} onClick={() => save.mutate()}>
                        {save.isPending ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
                    </Button>
                </div>
            </div>

            {fields
                .filter(f => FIELD_SLOTS.has(f.name))
                .map(field => {
                    const value = values[field.name] ?? '';
                    return (
                        <div key={field.name} className="flex flex-col gap-1.5">
                            <Label htmlFor={`email-field-${field.name}`}>{field.label}</Label>
                            <Input
                                id={`email-field-${field.name}`}
                                value={value}
                                placeholder={field.fallbackValue}
                                disabled={!canEdit}
                                onChange={e => setValues(v => ({ ...v, [field.name]: e.target.value }))}
                                onFocus={e => {
                                    lastTarget.current = { kind: 'field', name: field.name, element: e.target };
                                }}
                            />
                            {unknownVariables(value, knownVariables).map(name => (
                                <span key={name} className="text-xs text-destructive">
                                    <Trans>{`{{ ${name} }}`} is not a variable of this email.</Trans>
                                </span>
                            ))}
                        </div>
                    );
                })}

            {content?.variables.length ? (
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">
                        <Trans>Insert variable:</Trans>
                    </span>
                    {content.variables.map(variable => (
                        <button
                            key={variable.name}
                            type="button"
                            title={variable.label}
                            disabled={!canEdit}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => insertVariable(variable.name)}
                            className="rounded-md border px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                            {`{{ ${variable.name} }}`}
                        </button>
                    ))}
                </div>
            ) : null}

            {preview.error ? (
                <Alert variant="destructive">
                    <AlertDescription className="whitespace-pre-wrap">
                        {String((preview.error as any)?.message ?? preview.error)}
                    </AlertDescription>
                </Alert>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 text-sm">
                {canEdit ? (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                        <MousePointerClickIcon className="h-4 w-4" />
                        <Trans>Click any text in the email to change it.</Trans>
                    </span>
                ) : null}
                <ButtonGroup className="ml-auto">
                    <Button
                        type="button"
                        size="sm"
                        variant={width === 'desktop' ? 'default' : 'outline'}
                        onClick={() => setWidth('desktop')}
                        aria-pressed={width === 'desktop'}
                    >
                        <MonitorIcon />
                        <Trans>Desktop</Trans>
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant={width === 'mobile' ? 'default' : 'outline'}
                        onClick={() => setWidth('mobile')}
                        aria-pressed={width === 'mobile'}
                    >
                        <SmartphoneIcon />
                        <Trans>Mobile</Trans>
                    </Button>
                </ButtonGroup>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setPreviewVersion(v => v + 1)}
                    title={t`Refresh`}
                >
                    <RefreshCwIcon className={preview.isFetching ? 'animate-spin' : undefined} />
                </Button>
            </div>

            <div className="flex justify-center rounded-lg border bg-muted/40 p-4">
                {rendered ? (
                    <iframe
                        ref={iframeRef}
                        title={t`Email preview`}
                        srcDoc={srcDoc}
                        sandbox="allow-scripts"
                        className="h-[75vh] rounded-md border bg-white shadow-sm transition-[width]"
                        style={{ width: WIDTHS[width] }}
                    />
                ) : (
                    <div className="flex h-[40vh] items-center text-sm text-muted-foreground">
                        {preview.isFetching ? <Trans>Rendering…</Trans> : <Trans>No preview</Trans>}
                    </div>
                )}
            </div>

            {rendered ? (
                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
                    <dt className="text-muted-foreground">
                        <Trans>Subject</Trans>
                    </dt>
                    <dd data-testid="email-preview-subject">{rendered.subject}</dd>
                    <dt className="text-muted-foreground">
                        <Trans>From</Trans>
                    </dt>
                    <dd>{rendered.from}</dd>
                    <dt className="text-muted-foreground">
                        <Trans>To</Trans>
                    </dt>
                    <dd>{rendered.recipient}</dd>
                </dl>
            ) : null}

            {changed.length ? (
                <div className="flex flex-col gap-1.5 text-sm">
                    <span className="text-muted-foreground">
                        <Trans>Changed text</Trans>
                    </span>
                    {changed.map(field => (
                        <div key={field.name} className="flex items-center gap-2">
                            <span>{field.label}</span>
                            {dirtyNames.includes(field.name) ? (
                                <Badge variant="outline">
                                    <Trans>Unsaved</Trans>
                                </Badge>
                            ) : null}
                            <button
                                type="button"
                                disabled={!canEdit}
                                className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => resetToDefault(field.name)}
                            >
                                <RotateCcwIcon className="h-3 w-3" />
                                <Trans>Use default</Trans>
                            </button>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

/** The preview shows multi-line text with the line breaks of the email; trailing ones are noise. */
function normalize(text: string): string {
    return text.replace(/ /g, ' ').replace(/\n+$/, '');
}

function unknownVariables(text: string, known: Set<string>): string[] {
    const names = [...text.matchAll(/\{\{\{?\s*([^}\s]+)\s*\}?\}\}/g)].map(match => match[1]);
    return [...new Set(names)].filter(name => !known.has(name));
}
