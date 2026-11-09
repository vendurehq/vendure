import { api, Button, graphql, ListPage, PageActionBarRight, toast } from '@vendure/dashboard';
import { Link } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon } from 'lucide-react';

const inspectionListDocument = graphql(`
    query OnebridgeInspectionList($options: InspectionListOptions) {
        onebridgeInspectionReports(options: $options) {
            totalItems
            items {
                id
                code
                orderCode
                rfqCode
                inspector
                result
                passed
                publishedAt
                inspectedAt
            }
        }
    }
`);

const publishDocument = graphql(`
    mutation PublishOnebridgeInspection($id: ID!) {
        publishOnebridgeInspectionReport(id: $id) {
            id
            publishedAt
        }
    }
`);

export function OnebridgeInspectionListPage({ route }: { route: any }) {
    const queryClient = useQueryClient();
    const publishMutation = useMutation({
        mutationFn: (id: string) => api.mutate(publishDocument, { id }),
        onSuccess: () => {
            toast.success('验货报告已发布');
            queryClient.invalidateQueries();
        },
        onError: (e: any) => toast.error(`发布失败: ${e.message}`),
    });

    return (
        <ListPage
            pageId="onebridge-inspection-list"
            title="跨境验货"
            listQuery={inspectionListDocument}
            route={route}
            customizeColumns={{
                code: { header: '报告编号' },
                orderCode: { header: '订单' },
                rfqCode: { header: 'RFQ' },
                inspector: { header: '验货员' },
                result: { header: '结论' },
                passed: { header: '通过' },
                publishedAt: {
                    header: '发布状态',
                    cell: ({ row }: any) =>
                        row.original.publishedAt ? (
                            <span>已发布</span>
                        ) : (
                            <Button size="sm" onClick={() => publishMutation.mutate(row.original.id)}>
                                发布
                            </Button>
                        ),
                },
            }}
        >
            <PageActionBarRight>
                <Button render={<Link to="/onebridge/inspections/new" />}>
                    <PlusIcon className="mr-1 h-4 w-4" /> 新建报告
                </Button>
            </PageActionBarRight>
        </ListPage>
    );
}
