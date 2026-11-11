import { Trans, useLingui } from '@lingui/react/macro';
import {
    Button,
    ButtonGroup,
    Input,
    Label,
    NativeSelect,
    NativeSelectOption,
    Textarea,
} from '@vendure/dashboard';
import { AlignCenterIcon, AlignLeftIcon, RotateCcwIcon } from 'lucide-react';

import { EmailDesignData, EmailDesignField, EmailDesignValue, EmailDesignValues } from '../email.graphql';

/**
 * The fields of the email design, grouped into Brand and Layout. An empty field uses the fallback:
 * the all-channels design for a channel, or the value from code.
 */
export function EmailDesignForm({
    data,
    values,
    disabled,
    onChange,
}: Readonly<{
    data: EmailDesignData;
    values: EmailDesignValues;
    disabled: boolean;
    onChange: (name: string, value: EmailDesignValue | null) => void;
}>) {
    const groups: Array<{ id: EmailDesignField['group']; title: React.ReactNode }> = [
        { id: 'brand', title: <Trans>Brand</Trans> },
        { id: 'layout', title: <Trans>Layout</Trans> },
    ];
    return (
        <div className="flex flex-col gap-6">
            {groups.map(group => (
                <fieldset key={group.id} className="flex flex-col gap-4">
                    <legend className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {group.title}
                    </legend>
                    {data.fields
                        .filter(field => field.group === group.id)
                        .map(field => (
                            <DesignField
                                key={field.name}
                                field={field}
                                value={values[field.name]}
                                fallback={data.fallback[field.name] ?? data.defaults[field.name]}
                                fonts={data.fonts}
                                disabled={disabled}
                                onChange={value => onChange(field.name, value)}
                            />
                        ))}
                </fieldset>
            ))}
        </div>
    );
}

function DesignField({
    field,
    value,
    fallback,
    fonts,
    disabled,
    onChange,
}: Readonly<{
    field: EmailDesignField;
    value: EmailDesignValue | null | undefined;
    fallback: EmailDesignValue | null | undefined;
    fonts: EmailDesignData['fonts'];
    disabled: boolean;
    onChange: (value: EmailDesignValue | null) => void;
}>) {
    const { t } = useLingui();
    const id = `email-design-${field.name}`;
    const isSet = value != null && value !== '';
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
                <Label htmlFor={id}>{field.label}</Label>
                {isSet ? (
                    <button
                        type="button"
                        disabled={disabled}
                        title={t`Use the default`}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => onChange(null)}
                    >
                        <RotateCcwIcon className="h-3 w-3" />
                        <Trans>Reset</Trans>
                    </button>
                ) : null}
            </div>
            <FieldInput
                id={id}
                field={field}
                value={value}
                fallback={fallback}
                fonts={fonts}
                disabled={disabled}
                onChange={onChange}
            />
        </div>
    );
}

function FieldInput({
    id,
    field,
    value,
    fallback,
    fonts,
    disabled,
    onChange,
}: Readonly<{
    id: string;
    field: EmailDesignField;
    value: EmailDesignValue | null | undefined;
    fallback: EmailDesignValue | null | undefined;
    fonts: EmailDesignData['fonts'];
    disabled: boolean;
    onChange: (value: EmailDesignValue | null) => void;
}>) {
    const { t } = useLingui();
    const text = value == null ? '' : String(value);
    const placeholder = fallback == null ? '' : String(fallback);
    switch (field.kind) {
        case 'color':
            return (
                <div className="flex items-center gap-2">
                    <input
                        type="color"
                        aria-label={field.label}
                        disabled={disabled}
                        value={text || placeholder || '#000000'}
                        onChange={e => onChange(e.target.value)}
                        className="h-9 w-10 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
                    />
                    <Input
                        id={id}
                        value={text}
                        placeholder={placeholder}
                        disabled={disabled}
                        className="font-mono"
                        onChange={e => onChange(e.target.value)}
                    />
                </div>
            );
        case 'number':
            return (
                <Input
                    id={id}
                    type="number"
                    min={field.min ?? undefined}
                    max={field.max ?? undefined}
                    value={text}
                    placeholder={placeholder}
                    disabled={disabled}
                    onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
                />
            );
        case 'font':
            return (
                <NativeSelect
                    id={id}
                    value={text}
                    disabled={disabled}
                    onChange={e => onChange(e.target.value || null)}
                >
                    <NativeSelectOption value="">{t`Default`}</NativeSelectOption>
                    {fonts.map(font => (
                        <NativeSelectOption key={font.value} value={font.value}>
                            {font.label}
                        </NativeSelectOption>
                    ))}
                </NativeSelect>
            );
        case 'align':
            return <AlignInput value={text || placeholder} disabled={disabled} onChange={onChange} />;
        case 'multiline':
            return (
                <Textarea
                    id={id}
                    rows={2}
                    value={text}
                    placeholder={placeholder}
                    disabled={disabled}
                    onChange={e => onChange(e.target.value)}
                />
            );
        default:
            return (
                <Input
                    id={id}
                    type={field.kind === 'url' ? 'url' : 'text'}
                    value={text}
                    placeholder={placeholder}
                    disabled={disabled}
                    onChange={e => onChange(e.target.value)}
                />
            );
    }
}

function AlignInput({
    value,
    disabled,
    onChange,
}: Readonly<{ value: string; disabled: boolean; onChange: (value: string) => void }>) {
    return (
        <ButtonGroup>
            <Button
                type="button"
                size="sm"
                disabled={disabled}
                variant={value === 'center' ? 'outline' : 'default'}
                aria-pressed={value !== 'center'}
                onClick={() => onChange('left')}
            >
                <AlignLeftIcon />
                <Trans>Left</Trans>
            </Button>
            <Button
                type="button"
                size="sm"
                disabled={disabled}
                variant={value === 'center' ? 'default' : 'outline'}
                aria-pressed={value === 'center'}
                onClick={() => onChange('center')}
            >
                <AlignCenterIcon />
                <Trans>Center</Trans>
            </Button>
        </ButtonGroup>
    );
}
