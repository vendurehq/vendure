import { Money } from '@/vdb/components/data-display/money.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/vdb/components/ui/card.js';
import { Field, FieldLabel } from '@/vdb/components/ui/field.js';
import { RadioGroup, RadioGroupItem } from '@/vdb/components/ui/radio-group.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { Trans } from '@lingui/react/macro';

import { draftOrderEligibleShippingMethodsDocument } from '../orders.graphql.js';

type ShippingMethodQuote = ResultOf<
    typeof draftOrderEligibleShippingMethodsDocument
>['eligibleShippingMethodsForDraftOrder'][number];

export interface ShippingMethodSelection {
    shippingMethodId: string;
    /**
     * The code of one of the ShippingMethod's options. Omitted to let the server pick the cheapest.
     */
    shippingOptionCode?: string;
}

interface ShippingMethodSelectorProps {
    eligibleShippingMethods: ShippingMethodQuote[];
    selectedShippingMethodId?: string;
    selectedShippingOptionCode?: string | null;
    currencyCode: string;
    onSelect: (selection: ShippingMethodSelection) => void;
}

export function ShippingMethodSelector({
    eligibleShippingMethods,
    selectedShippingMethodId,
    selectedShippingOptionCode,
    currencyCode,
    onSelect,
}: Readonly<ShippingMethodSelectorProps>) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {eligibleShippingMethods?.length ? (
                eligibleShippingMethods.map(method => {
                    const isSelected = selectedShippingMethodId === method.id;
                    // A method whose calculator returns one price has a single option without a code
                    const hasOptions = method.options.length > 1;
                    return (
                        <Card
                            key={method.id}
                            className={`cursor-pointer hover:bg-muted/50 transition-colors border-2 border-transparent ${
                                isSelected ? 'border-primary' : ''
                            }`}
                            onClick={() => {
                                // Clicking the card of the selected method must not reset the chosen
                                // option to the cheapest one
                                if (!(isSelected && hasOptions)) {
                                    onSelect({ shippingMethodId: method.id });
                                }
                            }}
                        >
                            <CardHeader className="pb-2">
                                <CardTitle>{method.name}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-2">
                                    {method.description && (
                                        <p className="text-sm text-muted-foreground">{method.description}</p>
                                    )}
                                    {hasOptions ? (
                                        <ShippingOptionRadioGroup
                                            method={method}
                                            value={isSelected ? (selectedShippingOptionCode ?? '') : ''}
                                            currencyCode={currencyCode}
                                            onSelect={onSelect}
                                        />
                                    ) : (
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-medium">
                                                <Trans>Price</Trans>
                                            </span>
                                            <Money value={method.priceWithTax} currency={currencyCode} />
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    );
                })
            ) : (
                <div className="col-span-full text-center text-muted-foreground">
                    <Trans>No shipping methods available</Trans>
                </div>
            )}
        </div>
    );
}

function ShippingOptionRadioGroup({
    method,
    value,
    currencyCode,
    onSelect,
}: Readonly<{
    method: ShippingMethodQuote;
    value: string;
    currencyCode: string;
    onSelect: (selection: ShippingMethodSelection) => void;
}>) {
    return (
        // Choosing an option must not also trigger the card's click, which selects the cheapest option
        <div onClick={event => event.stopPropagation()}>
            <RadioGroup
                value={value}
                onValueChange={code =>
                    onSelect({ shippingMethodId: method.id, shippingOptionCode: code as string })
                }
                className="gap-2"
            >
                {method.options.map(option => {
                    const id = `shipping-option-${method.id}-${option.code}`;
                    return (
                        <Field key={option.code} orientation="horizontal" className="gap-2">
                            <RadioGroupItem value={option.code ?? ''} id={id} />
                            <FieldLabel htmlFor={id} className="flex-1 justify-between font-normal">
                                <span>{option.name ?? option.code}</span>
                                <Money value={option.priceWithTax} currency={currencyCode} />
                            </FieldLabel>
                        </Field>
                    );
                })}
            </RadioGroup>
        </div>
    );
}
