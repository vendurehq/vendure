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
import {
    EyeIcon,
    MonitorIcon,
    MousePointerClickIcon,
    PencilIcon,
    RefreshCwIcon,
    RotateCcwIcon,
    SmartphoneIcon,
} from 'lucide-react';
import { Dispatch, RefObject, SetStateAction, useEffect, useMemo, useRef, useState } from 'react';

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
import { SendTestEmailButton } from './send-test-email-dialog';

type EmailInfo = EmailOverviewResult['emailOverview']['emails'][number];

const WIDTHS = { desktop: 600, mobile: 375 } as const;

/** Slots that don't appear in the email body, so they are edited in fields above the preview. */
const FIELD_SLOTS = new Set(['subject', 'preview']);

/**
 * Edits the text of an email inside its preview. Click text in the email to change it. Variables
 * show as `{{ name }}`. The subject and the inbox preview text, which aren't in the body, have fields.
 */
/**
 * How the editor shows an email. The Emails page keeps it, so it stays the same when another email
 * is selected.
 */
export interface EmailEditorView {
    // Edit shows the text with {{ variables }} and lets you click it to change it. Preview shows the
    // email as sent, with the variables filled in from an order, and is where you pick that order.
    mode: 'edit' | 'preview';
    width: keyof typeof WIDTHS;
    languageCode?: string;
    scope: EmailContentScope;
}

export const defaultEmailEditorView: EmailEditorView = {
    mode: 'edit',
    width: 'desktop',
    scope: 'ALL_CHANNELS',
};

export function EmailEditorBlock({
    email,
    initialOrderCode,
    view,
    onViewChange,
}: Readonly<{
    email: EmailInfo;
    initialOrderCode?: string;
    view: EmailEditorView;
    onViewChange: Dispatch<SetStateAction<EmailEditorView>>;
}>) {
    const { t } = useLingui();
    const queryClient = useQueryClient();
    const { activeChannel } = useChannel();
    const { hasPermissions } = usePermissions();
    const canEdit = hasPermissions(['UpdateSettings']);
    const languages: string[] = activeChannel?.availableLanguageCodes ?? [];
    const { mode, width, scope } = view;
    const languageCode = view.languageCode ?? activeChannel?.defaultLanguageCode ?? 'en';
    const updateView = (change: Partial<EmailEditorView>) =>
        onViewChange(current => ({ ...current, ...change }));
    const [orderCode, setOrderCode] = useState(initialOrderCode ?? '');
    const [appliedOrderCode, setAppliedOrderCode] = useState(initialOrderCode ?? '');
    const editing = canEdit && mode === 'edit';
    const [values, setValues] = useState<Record<string, string>>({});
    // Bumped when the preview must re-render the body: after saving, discarding or resetting text.
    // Typing in the preview itself doesn't re-render it, so the cursor stays where it is.
    const [previewVersion, setPreviewVersion] = useState(0);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const lastTarget = useRef<
        { kind: 'field'; name: string; element: HTMLInputElement } | { kind: 'preview' }
    >();

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
        editable: editing,
    };
    const preview = useQuery<EmailPreviewResult>({
        queryKey: ['previewEmail', previewBase, previewVersion, debouncedFieldKey],
        queryFn: () =>
            api.query(previewEmailQuery, {
                input: {
                    ...previewBase,
                    content: Object.keys(draftRef.current).length ? draftRef.current : undefined,
                },
            }),
        retry: false,
        placeholderData: previous => previous,
    });
    const rendered = preview.data?.previewEmail;
    const srcDoc = useMemo(() => {
        if (!rendered) {
            return '';
        }
        return editing ? withInlineEditor(rendered.html, window.location.origin) : rendered.html;
    }, [rendered?.html, editing]);
    const portRef = usePreviewEditorPort(iframeRef, {
        onFocus: () => {
            lastTarget.current = { kind: 'preview' };
        },
        onInput: (slot, text) => setValues(v => ({ ...v, [slot]: normalize(text) })),
    });

    const save = useMutation({
        mutationFn: () =>
            api.mutate(updateEmailContentMutation, {
                input: { type: email.type, languageCode, scope, content: draftRef.current },
            }),
        onSuccess: (result: any) => {
            queryClient.setQueryData(['emailContent', contentVariables], {
                emailContent: result.updateEmailContent,
            });
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
            setValues(v => ({
                ...v,
                [target.name]: current.slice(0, start) + placeholder + current.slice(end),
            }));
            requestAnimationFrame(() => {
                target.element.focus();
                target.element.setSelectionRange(start + placeholder.length, start + placeholder.length);
            });
        } else {
            portRef.current?.postMessage({ source: INLINE_EDITOR_SOURCE, type: 'insert-variable', name });
        }
    };

    const switchMode = (next: 'edit' | 'preview') => {
        updateView({ mode: next });
        // Re-render with the current draft: a cached render from before would drop what was typed.
        setPreviewVersion(v => v + 1);
    };

    const knownVariables = new Set(content?.variables.map(v => v.name) ?? []);
    const changed = fields.filter(f => (values[f.name] ?? '') !== '');

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
                <TextSettings
                    languages={languages.length ? languages : [languageCode]}
                    languageCode={languageCode}
                    scope={scope}
                    channelCode={activeChannel?.code ?? ''}
                    onChange={updateView}
                />
                {canEdit ? <ModeToggle mode={mode} onChange={switchMode} /> : null}
                <div className="ml-auto flex gap-2">
                    <SendTestEmailButton
                        disabled={!canEdit}
                        input={{
                            type: email.type,
                            label: email.label,
                            languageCode,
                            channelCode: activeChannel?.code,
                            sampleArgs: previewBase.sampleArgs,
                            content: draft,
                        }}
                    />
                    <Button
                        type="button"
                        variant="outline"
                        disabled={!dirtyNames.length || save.isPending}
                        onClick={resetToStored}
                    >
                        <Trans>Discard</Trans>
                    </Button>
                    <Button
                        type="button"
                        disabled={!canEdit || !dirtyNames.length || save.isPending}
                        onClick={() => save.mutate()}
                    >
                        {save.isPending ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
                    </Button>
                </div>
            </div>
            {editing ? (
                <>
                    <TextFields
                        fields={fields.filter(f => FIELD_SLOTS.has(f.name))}
                        values={values}
                        disabled={!canEdit}
                        knownVariables={knownVariables}
                        onChange={(name, value) => setValues(v => ({ ...v, [name]: value }))}
                        onFocus={(name, element) => {
                            lastTarget.current = { kind: 'field', name, element };
                        }}
                    />
                    <VariableChips
                        variables={content?.variables ?? []}
                        disabled={!canEdit}
                        onInsert={insertVariable}
                    />
                </>
            ) : null}

            {preview.error ? (
                <PreviewErrorAlert
                    error={preview.error}
                    orderCode={appliedOrderCode}
                    onUseLatestOrder={() => {
                        setOrderCode('');
                        setAppliedOrderCode('');
                    }}
                />
            ) : null}

            <div className="flex flex-wrap items-center gap-3 text-sm">
                {editing ? (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                        <MousePointerClickIcon className="h-4 w-4" />
                        <Trans>
                            Click any text in the email to change it. Use Preview to see the variables filled
                            in.
                        </Trans>
                    </span>
                ) : null}
                {!editing && email.canSendFromOrder ? (
                    <OrderPicker
                        value={orderCode}
                        onChange={setOrderCode}
                        onApply={() => setAppliedOrderCode(orderCode.trim())}
                    />
                ) : null}
                <WidthToggle width={width} onChange={next => updateView({ width: next })} />
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

            <PreviewFrame
                frameRef={iframeRef}
                srcDoc={rendered ? srcDoc : undefined}
                width={width}
                fetching={preview.isFetching}
            />

            {rendered ? (
                <EmailHeaders subject={rendered.subject} from={rendered.from} to={rendered.recipient} />
            ) : null}

            {changed.length ? (
                <ChangedTextList
                    fields={changed}
                    unsaved={dirtyNames}
                    disabled={!canEdit}
                    onUseDefault={resetToDefault}
                />
            ) : null}
        </div>
    );
}

function TextSettings({
    languages,
    languageCode,
    scope,
    channelCode,
    onChange,
}: Readonly<{
    languages: string[];
    languageCode: string;
    scope: EmailContentScope;
    channelCode: string;
    onChange: (change: Partial<EmailEditorView>) => void;
}>) {
    const { t } = useLingui();
    return (
        <>
            <div className="flex flex-col gap-1.5">
                <Label htmlFor="email-language">
                    <Trans>Language</Trans>
                </Label>
                <NativeSelect
                    id="email-language"
                    value={languageCode}
                    onChange={e => onChange({ languageCode: e.target.value })}
                >
                    {languages.map(code => (
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
                    onChange={e => onChange({ scope: e.target.value as EmailContentScope })}
                >
                    <NativeSelectOption value="ALL_CHANNELS">{t`All channels`}</NativeSelectOption>
                    <NativeSelectOption value="CHANNEL">{t`This channel only (${channelCode})`}</NativeSelectOption>
                </NativeSelect>
            </div>
        </>
    );
}

function ModeToggle({
    mode,
    onChange,
}: Readonly<{ mode: EmailEditorView['mode']; onChange: (mode: EmailEditorView['mode']) => void }>) {
    return (
        <ButtonGroup>
            <Button
                type="button"
                variant={mode === 'edit' ? 'default' : 'outline'}
                aria-pressed={mode === 'edit'}
                onClick={() => onChange('edit')}
            >
                <PencilIcon />
                <Trans>Edit text</Trans>
            </Button>
            <Button
                type="button"
                variant={mode === 'preview' ? 'default' : 'outline'}
                aria-pressed={mode === 'preview'}
                onClick={() => onChange('preview')}
            >
                <EyeIcon />
                <Trans>Preview</Trans>
            </Button>
        </ButtonGroup>
    );
}

function WidthToggle({
    width,
    onChange,
}: Readonly<{ width: EmailEditorView['width']; onChange: (width: EmailEditorView['width']) => void }>) {
    return (
        <ButtonGroup className="ml-auto">
            <Button
                type="button"
                size="sm"
                variant={width === 'desktop' ? 'default' : 'outline'}
                onClick={() => onChange('desktop')}
                aria-pressed={width === 'desktop'}
            >
                <MonitorIcon />
                <Trans>Desktop</Trans>
            </Button>
            <Button
                type="button"
                size="sm"
                variant={width === 'mobile' ? 'default' : 'outline'}
                onClick={() => onChange('mobile')}
                aria-pressed={width === 'mobile'}
            >
                <SmartphoneIcon />
                <Trans>Mobile</Trans>
            </Button>
        </ButtonGroup>
    );
}

function PreviewFrame({
    frameRef,
    srcDoc,
    width,
    fetching,
}: Readonly<{
    frameRef: RefObject<HTMLIFrameElement | null>;
    srcDoc?: string;
    width: EmailEditorView['width'];
    fetching: boolean;
}>) {
    const { t } = useLingui();
    return (
        <div className="flex justify-center rounded-lg border bg-muted/40 p-4">
            {srcDoc === undefined ? (
                <div className="flex h-[40vh] items-center text-sm text-muted-foreground">
                    {fetching ? <Trans>Rendering…</Trans> : <Trans>No preview</Trans>}
                </div>
            ) : (
                <iframe
                    ref={frameRef}
                    title={t`Email preview`}
                    srcDoc={srcDoc}
                    sandbox="allow-scripts"
                    className="h-[75vh] rounded-md border bg-white shadow-sm transition-[width]"
                    style={{ width: WIDTHS[width] }}
                />
            )}
        </div>
    );
}

type ContentField = EmailContentData['fields'][number];

function TextFields({
    fields,
    values,
    disabled,
    knownVariables,
    onChange,
    onFocus,
}: Readonly<{
    fields: ContentField[];
    values: Record<string, string>;
    disabled: boolean;
    knownVariables: Set<string>;
    onChange: (name: string, value: string) => void;
    onFocus: (name: string, element: HTMLInputElement) => void;
}>) {
    return (
        <>
            {fields.map(field => {
                const value = values[field.name] ?? '';
                return (
                    <div key={field.name} className="flex flex-col gap-1.5">
                        <Label htmlFor={`email-field-${field.name}`}>{field.label}</Label>
                        <Input
                            id={`email-field-${field.name}`}
                            value={value}
                            placeholder={field.fallbackValue}
                            disabled={disabled}
                            onChange={e => onChange(field.name, e.target.value)}
                            onFocus={e => onFocus(field.name, e.target)}
                        />
                        {unknownVariables(value, knownVariables).map(name => (
                            <span key={name} className="text-xs text-destructive">
                                <Trans>{`{{ ${name} }}`} is not a variable of this email.</Trans>
                            </span>
                        ))}
                    </div>
                );
            })}
        </>
    );
}

function VariableChips({
    variables,
    disabled,
    onInsert,
}: Readonly<{
    variables: EmailContentData['variables'];
    disabled: boolean;
    onInsert: (name: string) => void;
}>) {
    if (!variables.length) {
        return null;
    }
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
                <Trans>Insert variable:</Trans>
            </span>
            {variables.map(variable => (
                <button
                    key={variable.name}
                    type="button"
                    title={variable.label}
                    disabled={disabled}
                    // Keeps the focus, and so the cursor, in the field or the preview.
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => onInsert(variable.name)}
                    className="rounded-md border px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                    {`{{ ${variable.name} }}`}
                </button>
            ))}
        </div>
    );
}

function PreviewErrorAlert({
    error,
    orderCode,
    onUseLatestOrder,
}: Readonly<{ error: unknown; orderCode: string; onUseLatestOrder: () => void }>) {
    if (orderCode && isSampleError(error)) {
        return (
            <Alert>
                <AlertDescription className="flex flex-wrap items-center gap-3">
                    <span>
                        <Trans>
                            Order {orderCode} has nothing this email can be about, for example no refund or no
                            shipment.
                        </Trans>
                    </span>
                    <Button type="button" size="sm" variant="outline" onClick={onUseLatestOrder}>
                        <Trans>Use the latest matching order</Trans>
                    </Button>
                </AlertDescription>
            </Alert>
        );
    }
    return (
        <Alert variant="destructive">
            <AlertDescription className="whitespace-pre-wrap">
                {String((error as any)?.message ?? error)}
            </AlertDescription>
        </Alert>
    );
}

function OrderPicker({
    value,
    onChange,
    onApply,
}: Readonly<{ value: string; onChange: (value: string) => void; onApply: () => void }>) {
    const { t } = useLingui();
    return (
        <form
            className="flex items-center gap-2"
            onSubmit={e => {
                e.preventDefault();
                onApply();
            }}
        >
            <Label htmlFor="email-order" className="text-muted-foreground">
                <Trans>Order</Trans>
            </Label>
            <Input
                id="email-order"
                className="h-8 w-56"
                placeholder={t`Latest matching order`}
                title={t`The order whose data fills in the preview. Nothing is sent.`}
                value={value}
                onChange={e => onChange(e.target.value)}
                onBlur={onApply}
            />
        </form>
    );
}

function EmailHeaders({
    subject,
    from,
    to,
}: Readonly<{ subject: string; from: string; to?: string | null }>) {
    return (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">
                <Trans>Subject</Trans>
            </dt>
            <dd data-testid="email-preview-subject">{subject}</dd>
            <dt className="text-muted-foreground">
                <Trans>From</Trans>
            </dt>
            <dd>{from}</dd>
            <dt className="text-muted-foreground">
                <Trans>To</Trans>
            </dt>
            <dd>{to}</dd>
        </dl>
    );
}

function ChangedTextList({
    fields,
    unsaved,
    disabled,
    onUseDefault,
}: Readonly<{
    fields: ContentField[];
    unsaved: string[];
    disabled: boolean;
    onUseDefault: (name: string) => void;
}>) {
    return (
        <div className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">
                <Trans>Changed text</Trans>
            </span>
            {fields.map(field => (
                <div key={field.name} className="flex items-center gap-2">
                    <span>{field.label}</span>
                    {unsaved.includes(field.name) ? (
                        <Badge variant="outline">
                            <Trans>Unsaved</Trans>
                        </Badge>
                    ) : null}
                    <button
                        type="button"
                        disabled={disabled}
                        className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => onUseDefault(field.name)}
                    >
                        <RotateCcwIcon className="h-3 w-3" />
                        <Trans>Use default</Trans>
                    </button>
                </div>
            ))}
        </div>
    );
}

/**
 * The private channel to the editor script in the preview iframe. The script sends one connect
 * message with a port. It must come from the preview frame, whose sandbox (no allow-same-origin)
 * gives it the opaque origin "null". All other messages go over the port. Replaced each time the
 * preview reloads.
 */
function usePreviewEditorPort(
    iframeRef: RefObject<HTMLIFrameElement | null>,
    handlers: { onFocus: () => void; onInput: (slot: string, text: string) => void },
) {
    const portRef = useRef<MessagePort | undefined>(undefined);
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    useEffect(() => {
        const onPortMessage = (event: MessageEvent) => {
            const data = event.data as { source?: string; type?: string; slot?: string; text?: string };
            if (data?.source !== INLINE_EDITOR_SOURCE || !data.slot) {
                return;
            }
            if (data.type === 'focus') {
                handlersRef.current.onFocus();
            } else if (data.type === 'input') {
                handlersRef.current.onInput(data.slot, data.text ?? '');
            }
        };
        const onMessage = (event: MessageEvent) => {
            const frame = iframeRef.current?.contentWindow;
            if (event.origin !== 'null' || !frame || event.source !== frame || !isConnectMessage(event)) {
                return;
            }
            portRef.current?.close();
            portRef.current = event.ports[0];
            portRef.current.onmessage = onPortMessage;
        };
        window.addEventListener('message', onMessage);
        return () => {
            window.removeEventListener('message', onMessage);
            portRef.current?.close();
        };
    }, []);

    return portRef;
}

/** The editor script's connect message. The listener checks the origin and the sender first. */
function isConnectMessage(event: MessageEvent): boolean {
    const data = event.data as { source?: string; type?: string } | undefined;
    return data?.source === INLINE_EDITOR_SOURCE && data.type === 'connect' && !!event.ports[0];
}

/** The preview shows multi-line text with the line breaks of the email; trailing ones are noise. */
function normalize(text: string): string {
    let end = text.length;
    while (end > 0 && text[end - 1] === '\n') {
        end--;
    }
    return text.slice(0, end).split('\u00a0').join(' ');
}

function unknownVariables(text: string, known: Set<string>): string[] {
    const names = [...text.matchAll(/\{\{\{?\s*([^{}\s]+)\s*\}?\}\}/g)].map(match => match[1]);
    return [...new Set(names)].filter(name => !known.has(name));
}

/** No sample data for the chosen order, or the email's filter rejected it. */
function isSampleError(error: unknown): boolean {
    const message = String((error as any)?.message ?? '');
    return message.includes('[sample]') || message.includes('[filter]');
}
