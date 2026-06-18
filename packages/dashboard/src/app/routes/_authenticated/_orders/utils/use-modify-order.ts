import { VariablesOf } from 'gql.tada';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { modifyOrderDocument } from '../orders.graphql.js';

import { AddressFragment, Order } from './order-types.js';

type ModifyOrderInput = VariablesOf<typeof modifyOrderDocument>['input'];

export type ProductVariantInfo = {
    productVariantId: string;
    productVariantName: string;
    sku: string;
    productAsset: {
        preview: string;
    };
    price?: number;
    priceWithTax?: number;
};

type SurchargeInput = NonNullable<ModifyOrderInput['surcharges']>[number];

export interface UseModifyOrderReturn {
    modifyOrderInput: ModifyOrderInput;
    addedVariants: Map<string, ProductVariantInfo>;
    addItem: (variant: ProductVariantInfo) => void;
    adjustLine: (params: {
        lineId: string;
        quantity: number;
        customFields: Record<string, any> | undefined;
    }) => void;
    removeLine: (params: { lineId: string }) => void;
    setShippingMethod: (params: { shippingMethodId: string }) => void;
    applyCouponCode: (params: { couponCode: string }) => void;
    removeCouponCode: (params: { couponCode: string }) => void;
    updateShippingAddress: (address: AddressFragment) => void;
    updateBillingAddress: (address: AddressFragment) => void;
    addSurcharge: (surcharge: SurchargeInput) => void;
    setNote: (note: string) => void;
    setRecalculateShipping: (recalculate: boolean) => void;
    hasModifications: boolean;
}

/**
 * Custom hook to manage order modification state and operations
 */
export function useModifyOrder(order: Order | null | undefined): UseModifyOrderReturn {
    const [modifyOrderInput, setModifyOrderInput] = useState<ModifyOrderInput>({
        orderId: '',
        addItems: [],
        adjustOrderLines: [],
        surcharges: [],
        note: '',
        couponCodes: [],
        options: {
            recalculateShipping: true,
        },
        dryRun: true,
    });

    const [addedVariants, setAddedVariants] = useState<Map<string, ProductVariantInfo>>(new Map());

    // Sync orderId and couponCodes when order changes
    useEffect(() => {
        setModifyOrderInput(prev => ({
            ...prev,
            orderId: order?.id ?? '',
            couponCodes: order?.couponCodes ?? [],
        }));
    }, [order?.id]);

    // Add item or increment existing line
    const addItem = useCallback(
        (variant: ProductVariantInfo) => {
            setModifyOrderInput(prev => {
                const existingLine = order?.lines.find(
                    line => line.productVariant.id === variant.productVariantId,
                );

                if (existingLine) {
                    const existingAdjustment = prev.adjustOrderLines?.find(
                        adj => adj.orderLineId === existingLine.id,
                    );

                    if (existingAdjustment) {
                        const newQuantity = existingAdjustment.quantity + 1;

                        // If back to original quantity, remove from adjustments
                        if (newQuantity === Number(existingLine.quantity)) {
                            return {
                                ...prev,
                                adjustOrderLines: (prev.adjustOrderLines ?? []).filter(
                                    adj => adj.orderLineId !== existingLine.id,
                                ),
                            };
                        }

                        return {
                            ...prev,
                            adjustOrderLines:
                                prev.adjustOrderLines?.map(adj =>
                                    adj.orderLineId === existingLine.id
                                        ? { ...adj, quantity: newQuantity }
                                        : adj,
                                ) ?? [],
                        };
                    } else {
                        return {
                            ...prev,
                            adjustOrderLines: [
                                ...(prev.adjustOrderLines ?? []),
                                { orderLineId: existingLine.id, quantity: existingLine.quantity + 1 },
                            ],
                        };
                    }
                } else {
                    return {
                        ...prev,
                        addItems: [
                            ...(prev.addItems ?? []),
                            { productVariantId: variant.productVariantId, quantity: 1 },
                        ],
                    };
                }
            });

            setAddedVariants(prev => {
                const newMap = new Map(prev);
                newMap.set(variant.productVariantId, variant);
                return newMap;
            });
        },
        [order],
    );

    // Adjust line quantity or custom fields
    const adjustLine = useCallback(
        ({
            lineId,
            quantity,
            customFields,
        }: {
            lineId: string;
            quantity: number;
            customFields: Record<string, any> | undefined;
        }) => {
            if (lineId.startsWith('added-')) {
                const productVariantId = lineId.replace('added-', '');
                setModifyOrderInput(prev => ({
                    ...prev,
                    addItems: (prev.addItems ?? []).map(item =>
                        item.productVariantId === productVariantId
                            ? { ...item, quantity, customFields }
                            : item,
                    ),
                }));
            } else {
                let normalizedCustomFields: Record<string, any> | undefined = customFields;
                if (normalizedCustomFields) {
                    delete normalizedCustomFields.__entityId__;
                }
                if (normalizedCustomFields && Object.keys(normalizedCustomFields).length === 0) {
                    normalizedCustomFields = undefined;
                }

                setModifyOrderInput(prev => {
                    const originalLine = order?.lines.find(l => l.id === lineId);
                    const isBackToOriginal = originalLine?.quantity === quantity;

                    const originalCustomFields = (originalLine as any)?.customFields;
                    const customFieldsChanged =
                        JSON.stringify(normalizedCustomFields) !== JSON.stringify(originalCustomFields);

                    const existing = (prev.adjustOrderLines ?? []).find(l => l.orderLineId === lineId);

                    // If back to original and custom fields unchanged, remove from adjustments
                    if (isBackToOriginal && !customFieldsChanged) {
                        return {
                            ...prev,
                            adjustOrderLines: (prev.adjustOrderLines ?? []).filter(
                                l => l.orderLineId !== lineId,
                            ),
                        };
                    }

                    const adjustOrderLines = existing
                        ? (prev.adjustOrderLines ?? []).map(l =>
                              l.orderLineId === lineId
                                  ? { ...l, quantity, customFields: normalizedCustomFields }
                                  : l,
                          )
                        : [
                              ...(prev.adjustOrderLines ?? []),
                              { orderLineId: lineId, quantity, customFields: normalizedCustomFields },
                          ];
                    return { ...prev, adjustOrderLines };
                });
            }
        },
        [order],
    );

    // Remove line
    const removeLine = useCallback(({ lineId }: { lineId: string }) => {
        if (lineId.startsWith('added-')) {
            const productVariantId = lineId.replace('added-', '');
            setModifyOrderInput(prev => ({
                ...prev,
                addItems: (prev.addItems ?? []).filter(item => item.productVariantId !== productVariantId),
            }));
            setAddedVariants(prev => {
                const newMap = new Map(prev);
                newMap.delete(productVariantId);
                return newMap;
            });
        } else {
            setModifyOrderInput(prev => {
                const existingAdjustment = (prev.adjustOrderLines ?? []).find(l => l.orderLineId === lineId);
                const adjustOrderLines = existingAdjustment
                    ? (prev.adjustOrderLines ?? []).map(l =>
                          l.orderLineId === lineId ? { ...l, quantity: 0 } : l,
                      )
                    : [...(prev.adjustOrderLines ?? []), { orderLineId: lineId, quantity: 0 }];
                return {
                    ...prev,
                    adjustOrderLines,
                };
            });
        }
    }, []);

    // Set shipping method
    const setShippingMethod = useCallback(({ shippingMethodId }: { shippingMethodId: string }) => {
        setModifyOrderInput(prev => ({
            ...prev,
            shippingMethodIds: [shippingMethodId],
        }));
    }, []);

    // Apply coupon code
    const applyCouponCode = useCallback(({ couponCode }: { couponCode: string }) => {
        setModifyOrderInput(prev => ({
            ...prev,
            couponCodes: prev.couponCodes?.includes(couponCode)
                ? prev.couponCodes
                : [...(prev.couponCodes ?? []), couponCode],
        }));
    }, []);

    // Remove coupon code
    const removeCouponCode = useCallback(({ couponCode }: { couponCode: string }) => {
        setModifyOrderInput(prev => ({
            ...prev,
            couponCodes: (prev.couponCodes ?? []).filter(code => code !== couponCode),
        }));
    }, []);

    // Update shipping address
    const updateShippingAddress = useCallback((address: AddressFragment) => {
        setModifyOrderInput(prev => ({
            ...prev,
            updateShippingAddress: {
                streetLine1: address.streetLine1,
                streetLine2: address.streetLine2,
                city: address.city,
                countryCode: address.country.code,
                fullName: address.fullName,
                postalCode: address.postalCode,
                province: address.province,
                company: address.company,
                phoneNumber: address.phoneNumber,
            },
        }));
    }, []);

    // Update billing address
    const updateBillingAddress = useCallback((address: AddressFragment) => {
        setModifyOrderInput(prev => ({
            ...prev,
            updateBillingAddress: {
                streetLine1: address.streetLine1,
                streetLine2: address.streetLine2,
                city: address.city,
                countryCode: address.country.code,
                fullName: address.fullName,
                postalCode: address.postalCode,
                province: address.province,
                company: address.company,
                phoneNumber: address.phoneNumber,
            },
        }));
    }, []);

    // Add surcharge
    const addSurcharge = useCallback((surcharge: SurchargeInput) => {
        setModifyOrderInput(prev => ({
            ...prev,
            surcharges: [...(prev.surcharges ?? []), surcharge],
        }));
    }, []);

    // Set note
    const setNote = useCallback((note: string) => {
        setModifyOrderInput(prev => ({
            ...prev,
            note: note || '',
        }));
    }, []);

    // Set recalculate shipping
    const setRecalculateShipping = useCallback((recalculate: boolean) => {
        setModifyOrderInput(prev => ({
            ...prev,
            options: {
                ...prev.options,
                recalculateShipping: recalculate,
            },
        }));
    }, []);

    // Check if there are modifications
    const hasModifications = useMemo(() => {
        return (
            (modifyOrderInput.addItems?.length ?? 0) > 0 ||
            (modifyOrderInput.adjustOrderLines?.length ?? 0) > 0 ||
            (modifyOrderInput.couponCodes?.length ?? 0) > 0 ||
            (modifyOrderInput.shippingMethodIds?.length ?? 0) > 0 ||
            (modifyOrderInput.surcharges?.length ?? 0) > 0 ||
            !!modifyOrderInput.updateShippingAddress ||
            !!modifyOrderInput.updateBillingAddress
        );
    }, [modifyOrderInput]);

    return {
        modifyOrderInput,
        addedVariants,
        addItem,
        adjustLine,
        removeLine,
        setShippingMethod,
        applyCouponCode,
        removeCouponCode,
        updateShippingAddress,
        updateBillingAddress,
        addSurcharge,
        setNote,
        setRecalculateShipping,
        hasModifications,
    };
}
