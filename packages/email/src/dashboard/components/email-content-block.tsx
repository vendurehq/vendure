import { Trans, useLingui } from '@lingui/react/macro';
import {
    api,
    Badge,
    Button,
    Input,
    Label,
    NativeSelect,
    NativeSelectOption,
    Textarea,
    toast,
    useChannel,
    useMutation,
    usePermissions,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import { RotateCcwIcon } from 'lucide-react';
import { type ChangeEvent, type FocusEvent, useEffect, useRef, useState } from 'react';

import {
    EmailContentData,
    emailContentQuery,
    EmailContentScope,
    updateEmailContentMutation,
} from '../email.graphql';

type FieldElement = HTMLInputElement | HTMLTextAreaElement;

/**
 * Edits the text of an email's content slots for one language, for the active channel or for all
 * channels. Unsaved text is passed to `onDraftChange` so the preview shows it while typing.
 */
export function EmailContentBlock({
    type,
    languageCode,
    onLanguageChange,
    onDraftChange,
}: Readonly<{
    type: string;
    languageCode: string;
    onLanguageChange: (languageCode: string) => void;
    onDraftChange: (draft: Record<string, string>) => void;
}>) {
    const { t } = useLingui();
    const queryClient = useQueryClient();
    const { activeChannel } = useChannel();
    const { hasPermissions } = usePermissions();
    const canEdit = hasPermissions(['UpdateSettings']);
    const languages: string[] = activeChannel?.availableLanguageCodes ?? [languageCode];
    const [scope, setScope] = useState<EmailContentScope>('ALL_CHANNELS');
    const [values, setValues] = useState<Record<string, string>>({});
    const lastFocused = useRef<{ name: string; element: FieldElement } | undefined>(undefined);

    const variables = { type, languageCode, scope };
    const { data, isLoading, error } = useQuery<{ emailContent: EmailContentData }>({
        queryKey: ['emailContent', variables],
        queryFn: () => api.query(emailContentQuery, variables),
    });
    const content = data?.emailContent;
    const knownVariables = new Set(content?.variables.map(v => v.name) ?? []);

    // Load the stored text whenever the email, language or scope changes.
    useEffect(() => {
        if (content) {
            setValues(Object.fromEntries(content.fields.map(f => [f.name, f.value ?? ''])));
        }
    }, [content]);

    const dirtyNames = content ? content.fields.filter(f => (values[f.name] ?? '') !== (f.value ?? '')).map(f => f.name) : [];

    // Debounced, so the preview re-renders after a pause in typing instead of on every key.
    useEffect(() => {
        const handle = setTimeout(() => {
            const draft: Record<string, string> = {};
            for (const name of dirtyNames) {
                draft[name] = values[name] ?? '';
            }
            onDraftChange(draft);
        }, 400);
        return () => clearTimeout(handle);
    }, [values, content]);

    const save = useMutation({
        mutationFn: () =>
            api.mutate(updateEmailContentMutation, {
                input: { type, languageCode, scope, content: Object.fromEntries(dirtyNames.map(n => [n, values[n] ?? ''])) },
            }),
        onSuccess: (result: any) => {
            queryClient.setQueryData(['emailContent', variables], { emailContent: result.updateEmailContent });
            void queryClient.invalidateQueries({ queryKey: ['previewEmail'] });
            onDraftChange({});
            toast.success(t`Email text saved`);
        },
        onError: (err: any) => toast.error(err?.message ?? t`Could not save the email text`),
    });

    const insertVariable = (name: string) => {
        const target = lastFocused.current;
        if (!target) {
            return;
        }
        const placeholder = `{{ ${name} }}`;
        const current = values[target.name] ?? '';
        const start = target.element.selectionStart ?? current.length;
        const end = target.element.selectionEnd ?? current.length;
        const next = current.slice(0, start) + placeholder + current.slice(end);
        setValues(v => ({ ...v, [target.name]: next }));
        requestAnimationFrame(() => {
            target.element.focus();
            target.element.setSelectionRange(start + placeholder.length, start + placeholder.length);
        });
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="email-content-language">
                        <Trans>Language</Trans>
                    </Label>
                    <NativeSelect
                        id="email-content-language"
                        value={languageCode}
                        onChange={e => onLanguageChange(e.target.value)}
                    >
                        {languages.map(code => (
                            <NativeSelectOption key={code} value={code}>
                                {code}
                            </NativeSelectOption>
                        ))}
                    </NativeSelect>
                </div>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="email-content-scope">
                        <Trans>Applies to</Trans>
                    </Label>
                    <NativeSelect
                        id="email-content-scope"
                        value={scope}
                        onChange={e => setScope(e.target.value as EmailContentScope)}
                    >
                        <NativeSelectOption value="ALL_CHANNELS">{t`All channels`}</NativeSelectOption>
                        <NativeSelectOption value="CHANNEL">
                            {t`This channel only (${activeChannel?.code ?? ''})`}
                        </NativeSelectOption>
                    </NativeSelect>
                </div>
                <div className="ml-auto flex gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        disabled={!dirtyNames.length || save.isPending}
                        onClick={() => content && setValues(Object.fromEntries(content.fields.map(f => [f.name, f.value ?? ''])))}
                    >
                        <Trans>Discard</Trans>
                    </Button>
                    <Button type="button" disabled={!canEdit || !dirtyNames.length || save.isPending} onClick={() => save.mutate()}>
                        {save.isPending ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
                    </Button>
                </div>
            </div>

            {error ? <p className="text-sm text-destructive">{String((error as any)?.message)}</p> : null}
            {isLoading ? (
                <p className="text-sm text-muted-foreground">
                    <Trans>Loading…</Trans>
                </p>
            ) : null}

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
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => insertVariable(variable.name)}
                            className="rounded-md border px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                            {`{{ ${variable.name} }}`}
                        </button>
                    ))}
                </div>
            ) : null}

            {content?.fields.map(field => {
                const value = values[field.name] ?? '';
                const id = `email-content-${field.name}`;
                const fieldProps = {
                    id,
                    value,
                    placeholder: field.fallbackValue,
                    disabled: !canEdit,
                    onChange: (e: ChangeEvent<FieldElement>) =>
                        setValues(v => ({ ...v, [field.name]: e.target.value })),
                    onFocus: (e: FocusEvent<FieldElement>) => {
                        lastFocused.current = { name: field.name, element: e.target };
                    },
                };
                return (
                    <div key={field.name} className="flex flex-col gap-1.5" data-testid={id}>
                        <div className="flex items-center gap-2">
                            <Label htmlFor={id}>{field.label}</Label>
                            {value ? (
                                <Badge variant="secondary">
                                    <Trans>Customised</Trans>
                                </Badge>
                            ) : null}
                            {value ? (
                                <button
                                    type="button"
                                    className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                    onClick={() => setValues(v => ({ ...v, [field.name]: '' }))}
                                >
                                    <RotateCcwIcon className="h-3 w-3" />
                                    <Trans>Use default</Trans>
                                </button>
                            ) : null}
                        </div>
                        {field.multiline ? <Textarea rows={3} {...fieldProps} /> : <Input {...fieldProps} />}
                        {unknownVariables(value, knownVariables).map(name => (
                            <span key={name} className="text-xs text-destructive">
                                <Trans>{`{{ ${name} }}`} is not a variable of this email.</Trans>
                            </span>
                        ))}
                    </div>
                );
            })}
            {content && !content.fields.length ? (
                <p className="text-sm text-muted-foreground">
                    <Trans>This email has no editable text.</Trans>
                </p>
            ) : null}
        </div>
    );
}

function unknownVariables(text: string, known: Set<string>): string[] {
    const names = [...text.matchAll(/\{\{\{?\s*([^}\s]+)\s*\}?\}\}/g)].map(match => match[1]);
    return [...new Set(names)].filter(name => !known.has(name));
}
