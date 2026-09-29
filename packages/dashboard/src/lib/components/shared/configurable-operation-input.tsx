import { ConfigurableOperationDefFragment } from '@/vdb/graphql/fragments.js';
import { cn } from '@/vdb/lib/utils.js';
import { useLingui } from '@lingui/react/macro';
import { ConfigurableOperationInput as ConfigurableOperationInputType } from '@vendure/common/lib/generated-types';
import { ChevronDown, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../ui/button.js';
import { Card, CardContent, CardHeader } from '../ui/card.js';
import { Field, FieldLabel } from '../ui/field.js';
import { ConfigurableOperationArgInput } from './configurable-operation-arg-input.js';
import { OperationSentence } from './configurable-operation-sentence.js';

export interface ConfigurableOperationInputProps {
    operationDefinition: ConfigurableOperationDefFragment;
    readonly?: boolean;
    removable?: boolean;
    position?: number;
    hideDescription?: boolean;
    /**
     * Controls the rendering style:
     * - 'sentence' (default): a compact one-line sentence with inline editable value chips
     * - 'form': the classic card with an always-visible argument form grid
     */
    variant?: 'sentence' | 'form';
    /**
     * When true (sentence variant only), the first arg with no value
     * opens its editing popover on mount. Used for newly-added operations.
     */
    autoOpenFirstEmptyArg?: boolean;
    value: ConfigurableOperationInputType;
    onChange: (val: ConfigurableOperationInputType) => void;
    onRemove?: () => void;
    onValidityChange?: (isValid: boolean) => void;
}

export function ConfigurableOperationInput({
    operationDefinition,
    readonly,
    removable,
    hideDescription,
    variant = 'sentence',
    autoOpenFirstEmptyArg,
    value,
    onChange,
    onRemove,
    onValidityChange,
}: Readonly<ConfigurableOperationInputProps>) {
    const { t } = useLingui();
    const [expanded, setExpanded] = useState(false);
    // Check validity of required fields and notify parent.
    // List args are exempt from required validation (matching legacy Angular admin-ui behavior)
    // because an empty array is considered a valid value for list types.
    useEffect(() => {
        if (!onValidityChange) return;

        const isValid = operationDefinition.args.every(arg => {
            if (!arg.required || arg.list) return true;
            const argValue = value.arguments.find(a => a.name === arg.name)?.value;
            // Args with a defaultValue are considered valid even when absent from
            // stored data. This handles legacy collections created before an arg
            // (e.g. combineWithAnd) was added to the filter definition.
            if (argValue === undefined && arg.defaultValue != null) return true;
            return argValue !== undefined && argValue !== '';
        });

        onValidityChange(isValid);
    }, [value.arguments, operationDefinition.args, onValidityChange]);

    const handleInputChange = (name: string, inputValue: string) => {
        const argIndex = value.arguments.findIndex(arg => arg.name === name);
        const stringValue = inputValue.toString();
        let updatedArgs: ConfigurableOperationInputType['arguments'];
        if (argIndex === -1) {
            updatedArgs = [...value.arguments, { name, value: stringValue }];
        } else {
            updatedArgs = value.arguments.map(arg =>
                arg.name === name ? { ...arg, value: stringValue } : arg,
            );
        }
        const newVal: ConfigurableOperationInputType = { ...value, arguments: updatedArgs };
        onChange(newVal);
    };

    if (variant === 'sentence') {
        return (
            <div className="group">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0 py-0.5">
                        <OperationSentence
                            operationDefinition={operationDefinition}
                            value={value}
                            onArgChange={handleInputChange}
                            readonly={readonly}
                            autoOpenFirstEmptyArg={autoOpenFirstEmptyArg}
                        />
                    </div>
                    {!readonly && (
                        <div className="flex items-center shrink-0">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setExpanded(!expanded)}
                                className="h-8 w-8 p-0 text-muted-foreground"
                                aria-label={t`Edit as form`}
                                aria-expanded={expanded}
                            >
                                <ChevronDown
                                    className={cn(
                                        'h-3.5 w-3.5 transition-transform',
                                        expanded && 'rotate-180',
                                    )}
                                />
                            </Button>
                            {removable !== false && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={onRemove}
                                    className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive"
                                    aria-label={t`Remove`}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </Button>
                            )}
                        </div>
                    )}
                </div>
                {expanded && (
                    <div className="mt-2 rounded-md border bg-muted/50 p-4 space-y-4">
                        <div className="text-xs text-muted-foreground font-mono">
                            {operationDefinition.code}
                        </div>
                        <ArgsFormGrid
                            operationDefinition={operationDefinition}
                            value={value}
                            readonly={readonly}
                            onArgChange={handleInputChange}
                        />
                    </div>
                )}
            </div>
        );
    }

    return (
        <div>
            <Card className="bg-muted/50 shadow-none">
                <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                            {!hideDescription && (
                                <div className="font-medium text-sm text-foreground leading-relaxed">
                                    {interpolateDescription(operationDefinition, value.arguments)}
                                </div>
                            )}

                            {operationDefinition.code && (
                                <div className="text-xs text-muted-foreground mt-1 font-mono">
                                    {operationDefinition.code}
                                </div>
                            )}
                        </div>

                        {removable !== false && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onRemove}
                                className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive"
                                disabled={readonly}
                            >
                                <X className="h-3.5 w-3.5" />
                            </Button>
                        )}
                    </div>
                </CardHeader>

                {operationDefinition.args && operationDefinition.args.length > 0 && (
                    <CardContent className="pt-0">
                        <div className="space-y-4">
                            <ArgsFormGrid
                                operationDefinition={operationDefinition}
                                value={value}
                                readonly={readonly}
                                onArgChange={handleInputChange}
                            />
                        </div>
                    </CardContent>
                )}
            </Card>
        </div>
    );
}

interface ArgsFormGridProps {
    operationDefinition: ConfigurableOperationDefFragment;
    value: ConfigurableOperationInputType;
    readonly?: boolean;
    onArgChange: (name: string, value: string) => void;
}

function ArgsFormGrid({ operationDefinition, value, readonly, onArgChange }: Readonly<ArgsFormGridProps>) {
    return (
        <div
            className={`grid gap-4 ${operationDefinition.args.length === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}
        >
            {operationDefinition.args
                .filter(arg => arg.ui?.component !== 'combination-mode-form-input')
                .map(arg => {
                    const argValue = value.arguments.find(a => a.name === arg.name)?.value || '';
                    return (
                        <Field key={arg.name} className="gap-2">
                            <FieldLabel className="text-sm font-medium text-foreground">
                                {arg.label || arg.name}
                                {arg.required && !arg.list && (
                                    <span className="text-destructive ml-1">*</span>
                                )}
                            </FieldLabel>
                            <ConfigurableOperationArgInput
                                definition={arg}
                                value={argValue}
                                onChange={value => onArgChange(arg.name, value)}
                                readOnly={readonly}
                            />
                        </Field>
                    );
                })}
        </div>
    );
}

/**
 * Interpolates the description of an ConfigurableOperation with the given values.
 */
export function interpolateDescription(
    operation: any,
    values: Array<{ name: string; value: string }>,
    precisionFactor = 2,
): string {
    if (!operation) {
        return '';
    }
    const templateString = operation.description;
    const interpolated = templateString.replace(
        /{\s*([a-zA-Z0-9]+)\s*}/gi,
        (substring: string, argName: string) => {
            const normalizedArgName = argName.toLowerCase();
            const value = values.find(v => v.name === normalizedArgName)?.value;
            if (value == null || value === '') {
                return '_';
            }
            let formatted = value;
            const argDef = operation.args.find((arg: any) => arg.name === normalizedArgName);
            if (
                argDef &&
                argDef.type === 'int' &&
                argDef.ui &&
                argDef.ui.component === 'currency-form-input'
            ) {
                formatted = (Number(value) / Math.pow(10, precisionFactor)).toString();
            }
            if (argDef && argDef.type === 'datetime' && (value as any) instanceof Date) {
                formatted = (value as any).toLocaleDateString();
            }
            return formatted;
        },
    );
    return interpolated;
}
