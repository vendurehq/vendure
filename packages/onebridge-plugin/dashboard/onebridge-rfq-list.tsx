import { graphql, ListPage } from '@vendure/dashboard';
import { Link } from '@tanstack/react-router';

const rfqListDocument = graphql(`
    query OnebridgeRfqList($options: RfqListOptions) {
        onebridgeRfqs(options: $options) {
            totalItems
            items {
                id
                code
                needType
                needLabel
                customerName
                customerContact
                stage
                createdAt
            }
        }
    }
`);

export function OnebridgeRfqListPage({ route }: { route: any }) {
    return (
        <ListPage
            pageId="onebridge-rfq-list"
            title="跨境询价"
            listQuery={rfqListDocument}
            route={route}
            customizeColumns={{
                code: {
                    header: '受理号',
                    cell: ({ row }: any) => <Link to={`/onebridge/rfqs/${row.original.id}`}>{row.original.code}</Link>,
                },
                needLabel: { header: '需求' },
                stage: { header: '阶段' },
                customerName: { header: '客户' },
                customerContact: { header: '联系方式' },
                createdAt: { header: '提交时间' },
            }}
        />
    );
}
