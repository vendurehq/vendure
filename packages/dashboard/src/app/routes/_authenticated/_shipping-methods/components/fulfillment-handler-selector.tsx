import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { api } from '@/vdb/graphql/api.js';
import { configurableOperationDefFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useQuery } from '@tanstack/react-query';
import { useLingui } from '@lingui/react/macro';

export const fulfillmentHandlersDocument = graphql(
    `
        query GetFulfillmentHandlers {
            fulfillmentHandlers {
                ...ConfigurableOperationDef
            }
        }
    `,
    [configurableOperationDefFragment],
);

interface FulfillmentHandlerSelectorProps {
    value: string | undefined;
    onChange: (value: string | undefined) => void;
}

export function FulfillmentHandlerSelector({ value, onChange }: Readonly<FulfillmentHandlerSelectorProps>) {
    const { t } = useLingui();

    const { data: fulfillmentHandlersData } = useQuery({
        queryKey: ['fulfillmentHandlers'],
        queryFn: () => api.query(fulfillmentHandlersDocument),
        staleTime: 1000 * 60 * 60 * 5,
    });

    const fulfillmentHandlers = fulfillmentHandlersData?.fulfillmentHandlers;

    const onFulfillmentHandlerSelected = (code: string) => {
        const fulfillmentHandler = fulfillmentHandlers?.find(fh => fh.code === code);
        if (!fulfillmentHandler) {
            return;
        }
        onChange(fulfillmentHandler.code);
    };

    return (
        <div>
            <Select onValueChange={onFulfillmentHandlerSelected} value={value ?? undefined}>
                <SelectTrigger>
                    <SelectValue placeholder={t`Select a fulfillment handler`} />
                </SelectTrigger>
                <SelectContent>
                    {fulfillmentHandlers?.map(fulfillmentHandler => (
                        <SelectItem key={fulfillmentHandler.code} value={fulfillmentHandler.code}>
                            {fulfillmentHandler.description}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
