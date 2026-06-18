import { Alert, AlertDescription } from '@/vdb/components/ui/alert.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ResultOf } from 'gql.tada';
import { useState } from 'react';
import { orderHistoryDocument, transitionOrderToStateDocument } from '../orders.graphql.js';

/**
 * Returns the state the order was in before it entered 'Modifying'.
 * @param orderId The order ID
 */
export function useTransitionOrderToState(orderId: string | undefined) {
    const [selectStateOpen, setSelectStateOpen] = useState(false);
    const [onSuccessFn, setOnSuccessFn] = useState<() => void>(() => {});
    const { data, isLoading, error } = useQuery({
        queryKey: ['orderPreModifyingState', orderId],
        queryFn: async () => {
            const result = await api.query(orderHistoryDocument, {
                id: orderId!,
                options: {
                    filter: { type: { eq: 'ORDER_STATE_TRANSITION' } },
                    sort: { createdAt: 'DESC' },
                    take: 50, // fetch enough history entries
                },
            });
            const items = result.order?.history?.items ?? [];
            const modifyingEntry = items.find(i => i.data?.to === 'Modifying');
            return modifyingEntry ? (modifyingEntry.data?.from as string | undefined) : '';
        },
        enabled: !!orderId,
    });
    const transitionOrderToStateMutation = useMutation({
        mutationFn: api.mutate(transitionOrderToStateDocument),
    });

    const transitionToState = async (state: string) => {
        if (orderId) {
            const { transitionOrderToState } = await transitionOrderToStateMutation.mutateAsync({
                id: orderId,
                state,
            });
            if (transitionOrderToState?.__typename === 'OrderStateTransitionError') {
                return transitionOrderToState.transitionError;
            }
        }
        return undefined;
    };

    const transitionToPreModifyingState = async () => {
        if (data && orderId) {
            return transitionToState(data);
        } else {
            return 'Could not find the state the order was in before it entered Modifying';
        }
    };

    const ManuallySelectNextState = (props: { availableStates: string[] }) => {
        const manuallyTransition = useMutation({
            mutationFn: api.mutate(transitionOrderToStateDocument),
            onSuccess: (result: ResultOf<typeof transitionOrderToStateDocument>) => {
                if (result.transitionOrderToState?.__typename === 'OrderStateTransitionError') {
                    setTransitionError(result.transitionOrderToState.transitionError);
                } else {
                    setTransitionError(undefined);
                    setSelectStateOpen(false);
                    onSuccessFn?.();
                }
            },
            onError: error => {
                setTransitionError(error.message);
            },
        });
        const [selectedState, setSelectedState] = useState<string | undefined>(undefined);
        const [transitionError, setTransitionError] = useState<string | undefined>(undefined);
        if (!orderId) {
            return null;
        }
        const onTransitionClick = () => {
            if (!selectedState) {
                return;
            }
            manuallyTransition.mutateAsync({
                id: orderId,
                state: selectedState,
            });
        };
        return (
            <Dialog open={selectStateOpen} onOpenChange={setSelectStateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            <Trans>Select next state</Trans>
                        </DialogTitle>
                    </DialogHeader>
                    <DialogDescription>
                        <Trans>Select the next state for the order</Trans>
                    </DialogDescription>
                    <Select items={Object.fromEntries(props.availableStates.map(state => [state, state]))} value={selectedState} onValueChange={(value) => { if (value != null) setSelectedState(value) }}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select a state" />
                        </SelectTrigger>
                        <SelectContent>
                            {props.availableStates.map(state => (
                                <SelectItem key={state} value={state}>
                                    {state}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {transitionError && (
                        <Alert variant="destructive">
                            <AlertDescription>
                                <Trans>Error transitioning to state</Trans>: {transitionError}
                            </AlertDescription>
                        </Alert>
                    )}
                    <DialogFooter>
                        <Button type="button" disabled={!selectedState} onClick={onTransitionClick}>
                            <Trans>Transition to selected state</Trans>
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    };
    return {
        isLoading,
        error,
        preModifyingState: data,
        transitionToPreModifyingState,
        transitionToState,
        ManuallySelectNextState,
        selectNextState: ({ onSuccess }: { onSuccess?: () => void | Promise<void> }) => {
            setSelectStateOpen(true);
            if (onSuccess) {
                setOnSuccessFn(() => onSuccess);
            }
        },
    };
}
