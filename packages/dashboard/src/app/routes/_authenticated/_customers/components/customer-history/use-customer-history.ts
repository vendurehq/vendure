import { api } from '@/vdb/graphql/api.js';
import { graphql, ResultOf } from '@/vdb/graphql/graphql.js';
import { useLingui } from '@lingui/react/macro';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { customerHistoryDocument } from '../../customers.graphql.js';
// Simplified mutation definitions - adjust based on your actual schema
const addCustomerNoteDocument = graphql(`
    mutation AddCustomerNote($customerId: ID!, $note: String!, $isPublic: Boolean!) {
        addNoteToCustomer(input: { id: $customerId, note: $note, isPublic: $isPublic }) {
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

const updateCustomerNoteDocument = graphql(`
    mutation UpdateCustomerNote($noteId: ID!, $note: String!) {
        updateCustomerNote(input: { noteId: $noteId, note: $note }) {
            id
        }
    }
`);

const deleteCustomerNoteDocument = graphql(`
    mutation DeleteCustomerNote($noteId: ID!) {
        deleteCustomerNote(id: $noteId) {
            result
            message
        }
    }
`);

export interface UseCustomerHistoryResult {
    historyEntries: NonNullable<ResultOf<typeof customerHistoryDocument>['customer']>['history']['items'];
    customer: ResultOf<typeof customerHistoryDocument>['customer'];
    loading: boolean;
    error: Error | null;
    addNote: (note: string, isPrivate: boolean) => void;
    updateNote: (noteId: string, note: string, isPrivate: boolean) => void;
    deleteNote: (noteId: string) => void;
    refetch: () => void;
    fetchNextPage: () => void;
    hasNextPage: boolean;
}

export function useCustomerHistory({
    customerId,
    pageSize = 10,
}: {
    customerId: string;
    pageSize?: number;
}): UseCustomerHistoryResult {
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
            api.query(customerHistoryDocument, {
                id: customerId,
                options: {
                    sort: { createdAt: 'DESC' },
                    skip: pageParam * pageSize,
                    take: pageSize,
                },
            }),
        queryKey: ['CustomerHistory', customerId],
        initialPageParam: 0,
        getNextPageParam: (lastPage, pages, lastPageParam) => {
            const totalItems = lastPage.customer?.history?.totalItems ?? 0;
            const currentMaxItem = (lastPageParam + 1) * pageSize;
            const nextPage = lastPageParam + 1;
            return currentMaxItem < totalItems ? nextPage : undefined;
        },
    });

    // Add note mutation
    const { mutate: addNoteMutation } = useMutation({
        mutationFn: api.mutate(addCustomerNoteDocument),
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
            customerId,
            note,
            isPublic: !isPrivate,
        });
    };

    // Update note mutation
    const { mutate: updateNoteMutation } = useMutation({
        mutationFn: api.mutate(updateCustomerNoteDocument),
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
        });
    };

    // Delete note mutation
    const { mutate: deleteNoteMutation } = useMutation({
        mutationFn: api.mutate(deleteCustomerNoteDocument),
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
        data?.pages.flatMap(page => page.customer?.history?.items).filter(x => x != null) ?? [];

    return {
        historyEntries,
        customer: data?.pages[0]?.customer ?? null,
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
