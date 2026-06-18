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
import { useQuery } from '@tanstack/react-query';
import { ConfigurableOperationInput as ConfigurableOperationInputType } from '@vendure/common/lib/generated-types';
import { Plus } from 'lucide-react';
import { ConfigurableOperationInput } from './configurable-operation-input.js';
import { getInitialConfigArgValue } from './configurable-operation-utils.js';

/**
 * Props interface for ConfigurableOperationSelector component
 */
export interface ConfigurableOperationSelectorProps {
    /** Current selected configurable operation value */
    value: ConfigurableOperationInputType | undefined;
    /** Callback function called when the selection changes */
    onChange: (value: ConfigurableOperationInputType | undefined) => void;
    /** GraphQL document for querying available operations */
    queryDocument: any;
    /** Unique key for the query cache */
    queryKey: string;
    /** Dot-separated path to extract operations from query result (e.g., "paymentMethodHandlers") */
    dataPath: string;
    /** Text to display on the selection button */
    buttonText: string;
    /** Text to display when no operations are available (defaults to "No options found") */
    emptyText?: string;
    /** Callback when validity of required args changes */
    onValidityChange?: (isValid: boolean) => void;
}

type QueryData = {
    [key: string]: {
        [key: string]: ConfigurableOperationDefFragment[];
    };
};

/**
 * ConfigurableOperationSelector - A reusable component for selecting a single configurable operation
 *
 * This component provides a standardized interface for selecting configurable operations such as:
 * - Payment method handlers
 * - Payment eligibility checkers
 * - Shipping calculators
 * - Shipping eligibility checkers
 *
 * Features:
 * - Displays the selected operation with its configuration form
 * - Provides a dropdown to select from available operations
 * - Handles operation selection with default argument values
 * - Supports removal of selected operations
 *
 * @example
 * ```tsx
 * <ConfigurableOperationSelector
 *   value={selectedHandler}
 *   onChange={setSelectedHandler}
 *   queryDocument={paymentHandlersDocument}
 *   queryKey="paymentMethodHandlers"
 *   dataPath="paymentMethodHandlers"
 *   buttonText="Select Payment Handler"
 * />
 * ```
 */
export function ConfigurableOperationSelector({
    value,
    onChange,
    queryDocument,
    queryKey,
    dataPath,
    buttonText,
    emptyText = 'No options found',
    onValidityChange,
}: Readonly<ConfigurableOperationSelectorProps>) {
    const { data } = useQuery<QueryData>({
        queryKey: [queryKey],
        queryFn: () => api.query(queryDocument),
        staleTime: 1000 * 60 * 60 * 5,
    });

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
        onChange({
            code: operation.code,
            arguments: operationDef.args.map(arg => ({
                name: arg.name,
                value: getInitialConfigArgValue(arg),
            })),
        });
    };

    const onOperationValueChange = (newVal: ConfigurableOperationInputType) => {
        onChange(newVal);
    };

    const onOperationRemove = () => {
        onChange(undefined);
        onValidityChange?.(true);
    };

    const operationDef = operations?.find((op: ConfigurableOperationDefFragment) => op.code === value?.code);

    return (
        <div className="flex flex-col gap-2 mt-4">
            {value && operationDef && (
                <div className="flex flex-col gap-2">
                    <ConfigurableOperationInput
                        operationDefinition={operationDef}
                        value={value}
                        onChange={v => onOperationValueChange(v)}
                        onRemove={() => onOperationRemove()}
                        onValidityChange={onValidityChange}
                    />
                </div>
            )}
            <DropdownMenu>
                {!value?.code && (
                    <DropdownMenuTrigger render={<Button variant="outline" className="w-fit" />}>
                            <Plus />
                            <Trans>{buttonText}</Trans>
                    </DropdownMenuTrigger>
                )}
                <DropdownMenuContent className="w-96">
                    {operations?.length ? (
                        operations.map((operation: ConfigurableOperationDefFragment) => (
                            <DropdownMenuItem
                                key={operation.code}
                                onClick={() => onOperationSelected(operation)}
                            >
                                {operation.description}
                            </DropdownMenuItem>
                        ))
                    ) : (
                        <DropdownMenuItem>{emptyText}</DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
