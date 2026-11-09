import { graphql, ListPage } from '@vendure/dashboard';
import { Link } from '@tanstack/react-router';

const customsListDocument = graphql(`
    query OnebridgeCustomsList($options: CustomsListOptions) {
        onebridgeCustomsRecords(options: $options) {
            totalItems
            items {
                id
                orderCode
                customsStatus
                declaredAt
                clearedAt
                declarationNo
                hsCode
                lastSyncedAt
            }
        }
    }
`);

export function OnebridgeCustomsListPage({ route }: { route: any }) {
    return (
        <ListPage
            pageId="onebridge-customs-list"
            title="跨境清关"
            listQuery={customsListDocument}
            route={route}
            customizeColumns={{
                orderCode: {
                    header: '订单号',
                    cell: ({ row }: any) => (
                        <Link to={`/onebridge/customs/${row.original.orderCode}`}>{row.original.orderCode}</Link>
                    ),
                },
                customsStatus: { header: '清关状态' },
                declarationNo: { header: '报关单号' },
                declaredAt: { header: '申报时间' },
                clearedAt: { header: '放行时间' },
                lastSyncedAt: { header: '最后同步' },
            }}
        />
    );
}
