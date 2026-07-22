import { api } from '@/vdb/graphql/api.js';
import {
    getSettingsStoreValueDocument,
    setSettingsStoreValueDocument,
} from '@/vdb/graphql/settings-store-operations.js';
import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export const CHANNEL_COLOR_SETTINGS_KEY = 'vendure.dashboard.channelColors';
export const channelColorValues = ['neutral', 'viz-1', 'viz-2', 'viz-3', 'viz-4', 'viz-5'] as const;
export type ChannelColor = (typeof channelColorValues)[number];
export type ChannelColorMap = Record<string, ChannelColor>;

const queryKey = ['settings-store', CHANNEL_COLOR_SETTINGS_KEY] as const;
const channelColorMutationQueues = new WeakMap<object, Promise<void>>();

function enqueueChannelColorMutation(owner: object, task: () => Promise<unknown>) {
    const queue = channelColorMutationQueues.get(owner) ?? Promise.resolve();
    const next = queue.then(task, task).then(
        () => undefined,
        () => undefined,
    );
    channelColorMutationQueues.set(owner, next);
}

function normalizeChannelColors(value: unknown): ChannelColorMap {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, ChannelColor] =>
            channelColorValues.includes(entry[1] as ChannelColor),
        ),
    );
}

export function useChannelColors() {
    const queryClient = useQueryClient();
    const { hasPermissions } = usePermissions();
    const query = useQuery({
        queryKey,
        queryFn: () => api.query(getSettingsStoreValueDocument, { key: CHANNEL_COLOR_SETTINGS_KEY }),
        retry: false,
    });
    const colors = normalizeChannelColors(query.data?.getSettingsStoreValue);
    const getCachedColors = () =>
        normalizeChannelColors(
            queryClient.getQueryData<{ getSettingsStoreValue?: unknown }>(queryKey)
                ?.getSettingsStoreValue,
        );

    const mutation = useMutation({
        scope: { id: CHANNEL_COLOR_SETTINGS_KEY },
        mutationFn: async ({ channelId, color }: { channelId: string; color: ChannelColor }) => {
            const nextColors = { ...getCachedColors(), [channelId]: color };
            const result = await api.mutate(setSettingsStoreValueDocument, {
                input: { key: CHANNEL_COLOR_SETTINGS_KEY, value: nextColors },
            });
            if (result.setSettingsStoreValue.error) {
                throw new Error(result.setSettingsStoreValue.error);
            }
            return result;
        },
        onMutate: async ({ channelId, color }) => {
            await queryClient.cancelQueries({ queryKey });
            const previous = queryClient.getQueryData(queryKey);
            const nextColors = { ...getCachedColors(), [channelId]: color };
            queryClient.setQueryData(queryKey, { getSettingsStoreValue: nextColors });
            return { previous };
        },
        onError: (error, _update, context) => {
            queryClient.setQueryData(queryKey, context?.previous);
            toast.error('Failed to update channel color', {
                description: error instanceof Error ? error.message : 'Unknown error',
            });
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey }),
    });

    const setColor = (channelId: string, color: ChannelColor) => {
        enqueueChannelColorMutation(queryClient, () => mutation.mutateAsync({ channelId, color }));
    };

    return {
        colors,
        getColor: (channelId: string): ChannelColor => colors[channelId] ?? 'neutral',
        setColor,
        canEdit: !query.isError && hasPermissions(['UpdateChannel']),
        isAvailable: !query.isError,
        isLoading: query.isLoading,
        isSaving: mutation.isPending,
    };
}
