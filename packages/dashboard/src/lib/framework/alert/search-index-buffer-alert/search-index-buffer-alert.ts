import { toast } from '@/vdb/components/ui/sonner.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';

import { DashboardAlertDefinition } from '../../extension-api/types/index.js';

const pendingSearchIndexUpdatesDocument = graphql(`
    query GetPendingSearchIndexUpdates {
        pendingSearchIndexUpdates
    }
`);

export const runPendingSearchIndexUpdatesDocument = graphql(`
    mutation RunPendingSearchIndexUpdates {
        runPendingSearchIndexUpdates {
            success
        }
    }
`);

export const searchIndexBufferAlert: DashboardAlertDefinition<number> = {
    id: 'search-index-buffer-alert',
    check: async () => {
        const data = await api.query(pendingSearchIndexUpdatesDocument);
        return data.pendingSearchIndexUpdates;
    },
    shouldShow: data => data > 0,
    title: data => /* i18n*/ `${data} pending search index updates`,
    severity: data => (data < 10 ? 'info' : 'warning'),
    actions: [
        {
            label: /* i18n*/ `Run pending updates`,
            onClick: async ({ dismiss }) => {
                await api.mutate(runPendingSearchIndexUpdatesDocument, {});
                toast.success(/* i18n*/ 'Running pending search index updates');
                dismiss();
            },
        },
    ],
    recheckInterval: 60_000,
};
