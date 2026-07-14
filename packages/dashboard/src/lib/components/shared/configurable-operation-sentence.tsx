import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { getInputComponent } from '@/vdb/framework/extension-api/input-component-extensions.js';
import { ConfigurableOperationDefFragment } from '@/vdb/graphql/fragments.js';
import { cn } from '@/vdb/lib/utils.js';
import { ConfigurableOperationInput as ConfigurableOperationInputType } from '@vendure/common/lib/generated-types';
import { useState } from 'react';
import { Field, FieldLabel } from '../ui/field.js';
import { ArgSummary, isEmptyArgValue } from './configurable-operation-arg-summary.js';
import { ConfigurableOperationArgInput } from './configurable-operation-arg-input.js';
import {
    OperationDescriptionSegment,
    parseOperationDescription,
} from './configurable-operation-description.js';

type ConfigurableOperationArgDef = ConfigurableOperationDefFragment['args'][number];

export interface OperationSentenceProps {
    operationDefinition: ConfigurableOperationDefFragment;
    value: ConfigurableOperationInputType;
    onArgChange: (name: string, value: string) => void;
    readonly?: boolean;
    /**
     * When true, the chip of the first required arg with no value opens its
     * editing popover on mount. Used for newly-added operations.
     */
    autoOpenFirstEmptyArg?: boolean;
}

/**
 * @description
 * Renders a configurable operation as an inline sentence based on its
 * description template, where each argument is an interactive chip that opens
 * a popover containing the arg's regular input component.
 *
 * @docsCategory components
 * @docsPage ConfigurableOperationSentence
 * @since 3.6.0
 */
export function OperationSentence({
    operationDefinition,
    value,
    onArgChange,
    readonly,
    autoOpenFirstEmptyArg,
}: Readonly<OperationSentenceProps>) {
    const segments = parseOperationDescription(operationDefinition);
    const argValueFor = (arg: ConfigurableOperationArgDef) =>
        value.arguments.find(a => a.name === arg.name)?.value ?? '';
    const firstEmptyRequiredArg = autoOpenFirstEmptyArg
        ? operationDefinition.args.find(
              arg => arg.required && !arg.list && isEmptyArgValue(arg, argValueFor(arg)),
          )
        : undefined;

    const referenced = segments.filter(s => s.type === 'text' || s.referenced);
    const trailing = segments.filter(
        (s): s is Extract<OperationDescriptionSegment, { type: 'arg' }> => s.type === 'arg' && !s.referenced,
    );

    const renderChip = (arg: ConfigurableOperationArgDef) => (
        <ArgChip
            key={arg.name}
            arg={arg}
            value={argValueFor(arg)}
            onChange={newValue => onArgChange(arg.name, newValue)}
            readonly={readonly}
            defaultOpen={firstEmptyRequiredArg?.name === arg.name}
        />
    );

    return (
        <span className="text-sm leading-7">
            {referenced.map((segment, i) =>
                segment.type === 'text' ? <span key={i}>{segment.text}</span> : renderChip(segment.arg),
            )}
            {trailing.map((segment, i) => (
                <span key={segment.arg.name}>
                    <span className="text-muted-foreground">
                        {(referenced.length > 0 || i > 0) && ' · '}
                        {segment.arg.label || segment.arg.name}:{' '}
                    </span>
                    {renderChip(segment.arg)}
                </span>
            ))}
        </span>
    );
}

interface ArgChipProps {
    arg: ConfigurableOperationArgDef;
    value: string;
    onChange: (value: string) => void;
    readonly?: boolean;
    defaultOpen?: boolean;
}

function ArgChip({ arg, value, onChange, readonly, defaultOpen }: Readonly<ArgChipProps>) {
    const [open, setOpen] = useState(defaultOpen ?? false);
    const isEmpty = isEmptyArgValue(arg, value);
    const isRequiredEmpty = isEmpty && arg.required && !arg.list;
    const label = arg.label || arg.name;

    const chipContent = isEmpty ? label : <ArgSummary fieldDef={arg} value={value} />;

    const chipClasses = cn(
        'inline-flex max-w-72 items-center truncate align-middle rounded-md border px-1.5 py-0.5 text-sm font-medium',
        isEmpty
            ? isRequiredEmpty
                ? 'border-dashed border-destructive text-destructive'
                : 'border-dashed text-muted-foreground'
            : 'bg-muted border-transparent',
        !readonly && 'cursor-pointer hover:border-border hover:bg-muted/80 transition-colors',
    );

    if (readonly) {
        return <span className={chipClasses}>{chipContent}</span>;
    }

    const popoverSize = getInputComponent(arg.ui?.component)?.metadata?.popoverSize ?? 'sm';

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                render={<button type="button" className={chipClasses} aria-label={label} />}
            >
                {chipContent}
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className={popoverSize === 'lg' ? 'w-[32rem] max-w-[90vw]' : 'w-80 max-w-[90vw]'}
            >
                <Field className="gap-2">
                    <FieldLabel className="text-sm font-medium text-foreground">
                        {label}
                        {arg.required && !arg.list && <span className="text-destructive ml-1">*</span>}
                    </FieldLabel>
                    <ConfigurableOperationArgInput definition={arg} value={value} onChange={onChange} />
                </Field>
            </PopoverContent>
        </Popover>
    );
}
