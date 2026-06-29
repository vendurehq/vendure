import { CombinationModeInput } from '@/vdb/components/data-input/combination-mode-input.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import { api } from '@/vdb/graphql/api.js';
import { ConfigurableOperationDefFragment } from '@/vdb/graphql/fragments.js';
import { Trans } from '@lingui/react/macro';
import { DefinedInitialDataOptions, useQuery, UseQueryOptions } from '@tanstack/react-query';
import { ConfigurableOperationInput as ConfigurableOperationInputType } from '@vendure/common/lib/generated-types';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { ConfigurableOperationInput } from './configurable-operation-input.js';
import { getInitialConfigArgValue } from './configurable-operation-utils.js';

/**
 * Props interface for ConfigurableOperationMultiSelector component
 */
export interface ConfigurableOperationMultiSelectorProps {
    /** Array of currently selected configurable operations */
    value: ConfigurableOperationInputType[];
    /** Callback function called when the selection changes */
    onChange: (value: ConfigurableOperationInputType[]) => void;
    /** GraphQL document for querying available operations (alternative to queryOptions) */
    queryDocument?: any;
    /** Pre-configured query options for more complex queries (alternative to queryDocument) */
    queryOptions?: UseQueryOptions<any> | DefinedInitialDataOptions<any>;
    /** Unique key for the query cache */
    queryKey: string;
    /** Dot-separated path to extract operations from query result (e.g., "promotionConditions") */
    dataPath: string;
    /** Text to display on the add button */
    buttonText: string;
    /** Title to show at the top of the dropdown menu (only when showEnhancedDropdown is true) */
    dropdownTitle?: string;
    /** Text to display when no operations are available (defaults to "No options found") */
    emptyText?: string;
    /**
     * Controls the dropdown display style:
     * - true: Enhanced dropdown with larger width (w-80), section title, operation descriptions + codes
     * - false: Simple dropdown with standard width (w-96), just operation descriptions
     *
     * Enhanced style is used by promotion conditions/actions for better UX with complex operations.
     * Simple style is used by collection filters for a cleaner, more compact appearance.
     */
    showEnhancedDropdown?: boolean;
    /** Callback when validity of required args changes (all operations must be valid) */
    onValidityChange?: (isValid: boolean) => void;
}

type QueryData = {
    [key: string]: ConfigurableOperationDefFragment[];
};

/**
 * ConfigurableOperationMultiSelector - A reusable component for selecting multiple configurable operations
 *
 * This component provides a standardized interface for selecting multiple configurable operations such as:
 * - Collection filters
 * - Promotion conditions
 * - Promotion actions
 *
 * Features:
 * - Displays all selected operations with their configuration forms
 * - Provides a dropdown to add new operations from available options
 * - Handles individual operation updates and removals
 * - Supports position-based combination mode for operations
 * - Flexible query patterns (direct document or pre-configured options)
 * - Two dropdown styles: enhanced (with operation codes) or simple
 *
 * @example
 * ```tsx
 * // Enhanced dropdown style (promotions)
 * <ConfigurableOperationMultiSelector
 *   value={conditions}
 *   onChange={setConditions}
 *   queryDocument={promotionConditionsDocument}
 *   queryKey="promotionConditions"
 *   dataPath="promotionConditions"
 *   buttonText="Add condition"
 *   dropdownTitle="Available Conditions"
 *   showEnhancedDropdown={true}
 * />
 *
 * // Simple dropdown style (collections)
 * <ConfigurableOperationMultiSelector
 *   value={filters}
 *   onChange={setFilters}
 *   queryOptions={getCollectionFiltersQueryOptions}
 *   queryKey="getCollectionFilters"
 *   dataPath="collectionFilters"
 *   buttonText="Add collection filter"
 *   showEnhancedDropdown={false}
 * />
 * ```
 */
export function ConfigurableOperationMultiSelector({
    value,
    onChange,
    queryDocument,
    queryOptions,
    queryKey,
    dataPath,
    buttonText,
    dropdownTitle,
    emptyText = 'No options found',
    showEnhancedDropdown = true,
    onValidityChange,
}: Readonly<ConfigurableOperationMultiSelectorProps>) {
    // Track validity for each operation by code+index to handle reordering/removal.
    // When operations change, we clear and let each ConfigurableOperationInput re-report.
    const validityMapRef = useRef<Record<string, boolean>>({});
    const prevValueRef = useRef(value);

    // Create stable key for each operation (code + position)
    const getOperationKey = (operation: ConfigurableOperationInputType, index: number) =>
        `${operation.code}:${index}`;

    const updateOperationValidity = useCallback(
        (index: number, isValid: boolean) => {
            const operation = value[index];
            if (!operation) return;
            const key = getOperationKey(operation, index);
            validityMapRef.current[key] = isValid;
            if (onValidityChange) {
                const allValid =
                    value.length === 0 ||
                    value.every((op, i) => validityMapRef.current[getOperationKey(op, i)] !== false);
                onValidityChange(allValid);
            }
        },
        [onValidityChange, value],
    );

    // Reset validity map when operations array changes (add/remove/reorder)
    useEffect(() => {
        const prevCodes = prevValueRef.current.map(op => op.code).join(',');
        const currCodes = value.map(op => op.code).join(',');
        if (prevCodes !== currCodes) {
            // Operations changed - clear map and let components re-report
            validityMapRef.current = {};
            // Temporarily report as valid until components re-validate
            if (onValidityChange && value.length === 0) {
                onValidityChange(true);
            }
        }
        prevValueRef.current = value;
    }, [value, onValidityChange]);

    const { data } = useQuery<QueryData>(
        queryOptions || {
            queryKey: [queryKey],
            queryFn: () => api.query(queryDocument),
            staleTime: 1000 * 60 * 60 * 5,
        },
    );

    // Extract operations from the data using the provided path
    const operations = dataPath.split('.').reduce<any>((obj, key) => {
        if (obj && typeof obj === 'object') {
            return obj[key];
        }
        return undefined;
    }, data) as ConfigurableOperationDefFragment[] | undefined;

    const onOperationSelected = (operation: ConfigurableOperationDefFragment) => {
        const operationDef = operations?.find(
            (op: ConfigurableOperationDefFragment) => op.code === operation.code,
        );
        if (!operationDef) {
            return;
        }
        onChange([
            ...value,
            {
                code: operation.code,
                arguments: operationDef.args.map(arg => ({
                    name: arg.name,
                    value: getInitialConfigArgValue(arg),
                })),
            },
        ]);
    };

    const onOperationValueChange = (index: number, newVal: ConfigurableOperationInputType) => {
        onChange(value.map((op, i) => (i === index ? newVal : op)));
    };

    const onOperationRemove = (index: number) => {
        onChange(value.filter((_, i) => i !== index));
    };

    const onCombinationModeChange = (index: number, newValue: boolean | string) => {
        const updatedValue = [...value];
        const operation = updatedValue[index];
        if (operation) {
            const updatedOperation = {
                ...operation,
                arguments: operation.arguments.map(arg =>
                    arg.name === 'combineWithAnd' ? { ...arg, value: newValue.toString() } : arg,
                ),
            };
            updatedValue[index] = updatedOperation;
            onChange(updatedValue);
        }
    };

    const hasOperations = value && value.length > 0;

    return (
        <div className="space-y-4">
            {hasOperations && (
                <div className="space-y-0">
                    {value.map((operation, index) => {
                        const operationDef = operations?.find(
                            (op: ConfigurableOperationDefFragment) => op.code === operation.code,
                        );
                        if (!operationDef) {
                            return null;
                        }
                        const hasCombinationMode = operation.arguments.find(
                            arg => arg.name === 'combineWithAnd',
                        );
                        return (
                            <div key={index + operation.code}>
                                {index > 0 && hasCombinationMode ? (
                                    <div className="my-2">
                                        <CombinationModeInput
                                            value={
                                                operation.arguments.find(arg => arg.name === 'combineWithAnd')
                                                    ?.value ?? 'true'
                                            }
                                            onChange={(newValue: boolean | string) =>
                                                onCombinationModeChange(index, newValue)
                                            }
                                            name={''}
                                            ref={() => {}}
                                            onBlur={() => {}}
                                            position={index}
                                        />
                                    </div>
                                ) : (
                                    <div className="h-4" />
                                )}
                                <ConfigurableOperationInput
                                    operationDefinition={operationDef}
                                    value={operation}
                                    onChange={value => onOperationValueChange(index, value)}
                                    onRemove={() => onOperationRemove(index)}
                                    onValidityChange={isValid => updateOperationValidity(index, isValid)}
                                />
                            </div>
                        );
                    })}
                </div>
            )}

            <div className={hasOperations ? 'pt-2' : ''}>
                <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="outline" className="w-full sm:w-auto" />}>
                            <Plus className="h-4 w-4" />
                            <Trans>{buttonText}</Trans>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className={showEnhancedDropdown ? 'w-80 max-h-[min(600px,50vh)] overflow-y-auto' : 'w-96 max-h-[min(600px,50vh)] overflow-y-auto'} align="start">
                        {showEnhancedDropdown && dropdownTitle && (
                            <div className="px-2 py-1.5 text-sm font-medium text-muted-foreground">
                                {dropdownTitle}
                            </div>
                        )}
                        {operations?.length ? (
                            operations.map((operation: ConfigurableOperationDefFragment) => (
                                <DropdownMenuItem
                                    key={operation.code}
                                    onClick={() => onOperationSelected(operation)}
                                    className={
                                        showEnhancedDropdown
                                            ? 'flex flex-col items-start py-3 cursor-pointer'
                                            : undefined
                                    }
                                >
                                    {showEnhancedDropdown ? (
                                        <>
                                            <div className="font-medium text-sm">{operation.description}</div>
                                            <div className="text-xs text-muted-foreground font-mono mt-1">
                                                {operation.code}
                                            </div>
                                        </>
                                    ) : (
                                        operation.description
                                    )}
                                </DropdownMenuItem>
                            ))
                        ) : (
                            <DropdownMenuItem>{emptyText}</DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
}
