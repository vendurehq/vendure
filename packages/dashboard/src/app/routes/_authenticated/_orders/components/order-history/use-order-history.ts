import { api } from '@/vdb/graphql/api.js';
import { graphql, ResultOf } from '@/vdb/graphql/graphql.js';
import { useLingui } from '@lingui/react/macro';
import { QueryKey, useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { orderHistoryDocument } from '../../orders.graphql.js';

// Simplified mutation definitions - adjust based on your actual schema
const addOrderNoteDocument = graphql(`
    mutation AddOrderNote($orderId: ID!, $note: String!, $isPublic: Boolean!) {
        addNoteToOrder(input: { id: $orderId, note: $note, isPublic: $isPublic }) {
            id
            history(options: { take: 1, sort: { createdAt: DESC } }) {
                items {
                    id
                    createdAt
                    type
                    isPublic
                    data
                }
            }
        }
    }
`);

const updateOrderNoteDocument = graphql(`
    mutation UpdateOrderNote($noteId: ID!, $note: String!, $isPublic: Boolean!) {
        updateOrderNote(input: { noteId: $noteId, note: $note, isPublic: $isPublic }) {
            id
        }
    }
`);

const deleteOrderNoteDocument = graphql(`
    mutation DeleteOrderNote($noteId: ID!) {
        deleteOrderNote(id: $noteId) {
            result
            message
        }
    }
`);

export interface UseOrderHistoryResult {
    historyEntries: NonNullable<ResultOf<typeof orderHistoryDocument>['order']>['history']['items'];
    order: ResultOf<typeof orderHistoryDocument>['order'];
    loading: boolean;
    error: Error | null;
    addNote: (note: string, isPrivate: boolean) => void;
    updateNote: (noteId: string, note: string, isPrivate: boolean) => void;
    deleteNote: (noteId: string) => void;
    refetch: () => void;
    fetchNextPage: () => void;
    hasNextPage: boolean;
}

export function orderHistoryQueryKey(orderId: string): QueryKey {
    return ['OrderHistory', orderId];
}

export function useOrderHistory({
    orderId,
    pageSize = 10,
}: {
    orderId: string;
    pageSize?: number;
}): UseOrderHistoryResult {
    const [isLoading, setIsLoading] = useState(false);
    const { i18n } = useLingui();

    // Fetch order history
    const {
        data,
        isLoading: isLoadingQuery,
        error,
        refetch,
        fetchNextPage,
        hasNextPage,
    } = useInfiniteQuery({
        queryFn: ({ pageParam = 0 }) =>
            api.query(orderHistoryDocument, {
                id: orderId,
                options: {
                    sort: { createdAt: 'DESC' },
                    skip: pageParam * pageSize,
                    take: pageSize,
                },
            }),
        queryKey: orderHistoryQueryKey(orderId),
        initialPageParam: 0,
        getNextPageParam: (lastPage, _pages, lastPageParam) => {
            const totalItems = lastPage.order?.history?.totalItems ?? 0;
            const currentMaxItem = (lastPageParam + 1) * pageSize;
            const nextPage = lastPageParam + 1;
            return currentMaxItem < totalItems ? nextPage : undefined;
        },
    });

    // Add note mutation
    const { mutate: addNoteMutation } = useMutation({
        mutationFn: api.mutate(addOrderNoteDocument),
        onSuccess: () => {
            toast.success(i18n.t('Note added successfully'));
            void refetch();
        },
        onError: () => {
            toast.error(i18n.t('Failed to add note'));
        },
    });

    const addNote = (note: string, isPrivate: boolean) => {
        setIsLoading(true);
        addNoteMutation({
            orderId,
            note,
            isPublic: !isPrivate, // isPrivate in UI is the opposite of isPublic in API
        });
    };

    // Update note mutation
    const { mutate: updateNoteMutation } = useMutation({
        mutationFn: api.mutate(updateOrderNoteDocument),
        onSuccess: () => {
            toast.success(i18n.t('Note updated successfully'));
            void refetch();
        },
        onError: () => {
            toast.error(i18n.t('Failed to update note'));
        },
    });
    const updateNote = (noteId: string, note: string, isPrivate: boolean) => {
        setIsLoading(true);

        updateNoteMutation({
            noteId,
            note,
            isPublic: !isPrivate, // isPrivate in UI is the opposite of isPublic in API
        });
    };

    // Delete note mutation
    const { mutate: deleteNoteMutation } = useMutation({
        mutationFn: api.mutate(deleteOrderNoteDocument),
        onSuccess: () => {
            toast.success(i18n.t('Note deleted successfully'));
            void refetch();
        },
        onError: () => {
            toast.error(i18n.t('Failed to delete note'));
        },
    });
    const deleteNote = (noteId: string) => {
        setIsLoading(true);
        deleteNoteMutation({
            noteId,
        });
    };

    const historyEntries =
        data?.pages.flatMap(page => page.order?.history?.items).filter(x => x != null) ?? [];

    return {
        historyEntries: historyEntries as any,
        order: data?.pages[0]?.order ?? null,
        loading: isLoadingQuery || isLoading,
        error,
        addNote,
        updateNote,
        deleteNote,
        refetch,
        fetchNextPage,
        hasNextPage,
    };
}
