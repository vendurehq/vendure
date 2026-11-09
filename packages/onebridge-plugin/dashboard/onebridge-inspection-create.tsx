import { api, Button, Card, graphql, Page, PageBlock, PageLayout, PageTitle, toast } from '@vendure/dashboard';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

const createInspectionDocument = graphql(`
    mutation CreateOnebridgeInspection($input: InspectionReportInput!) {
        createOnebridgeInspectionReport(input: $input) {
            id
            code
            publishedAt
        }
    }
`);

const publishInspectionDocument = graphql(`
    mutation PublishOnebridgeInspection($id: ID!) {
        publishOnebridgeInspectionReport(id: $id) {
            id
            publishedAt
        }
    }
`);

const RESULTS = ['pass', 'fail', 'conditional'];

export function OnebridgeInspectionCreatePage() {
    const [form, setForm] = useState<any>({
        orderCode: '',
        rfqCode: '',
        inspector: '',
        result: 'pass',
        notesKr: '',
        notesCn: '',
        publish: true,
    });

    const createMutation = useMutation({
        mutationFn: async () => {
            const created: any = await api.mutate(createInspectionDocument, {
                input: {
                    orderCode: form.orderCode || null,
                    rfqCode: form.rfqCode || null,
                    inspector: form.inspector,
                    result: form.result,
                    notesKr: form.notesKr || null,
                    notesCn: form.notesCn || null,
                },
            });
            const report = created.createOnebridgeInspectionReport;
            if (form.publish && report?.id) {
                await api.mutate(publishInspectionDocument, { id: report.id });
            }
            return report;
        },
        onSuccess: report => {
            toast.success(`验货报告已创建: ${report?.code ?? ''}`);
            setForm((prev: any) => ({ ...prev, orderCode: '', rfqCode: '', notesKr: '', notesCn: '' }));
        },
        onError: (e: any) => toast.error(`创建失败: ${e.message}`),
    });

    const set = (key: string, value: any) => setForm((prev: any) => ({ ...prev, [key]: value }));

    return (
        <Page pageId="onebridge-inspection-create">
            <PageTitle>新建验货报告</PageTitle>
            <PageLayout>
                <PageBlock column="main" blockId="onebridge-inspection-form">
                    <Card>
                        <div className="grid grid-cols-2 gap-3 p-4 text-sm">
                            <label className="flex flex-col gap-1">
                                订单号（与 RFQ 二选一）
                                <input
                                    className="border rounded px-2 py-1"
                                    value={form.orderCode}
                                    onChange={e => set('orderCode', e.target.value)}
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                RFQ 受理号（与订单二选一）
                                <input
                                    className="border rounded px-2 py-1"
                                    value={form.rfqCode}
                                    onChange={e => set('rfqCode', e.target.value)}
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                验货员
                                <input
                                    className="border rounded px-2 py-1"
                                    value={form.inspector}
                                    onChange={e => set('inspector', e.target.value)}
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                结论
                                <select
                                    className="border rounded px-2 py-1"
                                    value={form.result}
                                    onChange={e => set('result', e.target.value)}
                                >
                                    {RESULTS.map(x => (
                                        <option key={x} value={x}>
                                            {x}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1 col-span-2">
                                韩文备注（待补，勿自造）
                                <textarea
                                    className="border rounded px-2 py-1"
                                    rows={2}
                                    value={form.notesKr}
                                    onChange={e => set('notesKr', e.target.value)}
                                />
                            </label>
                            <label className="flex flex-col gap-1 col-span-2">
                                中文备注
                                <textarea
                                    className="border rounded px-2 py-1"
                                    rows={2}
                                    value={form.notesCn}
                                    onChange={e => set('notesCn', e.target.value)}
                                />
                            </label>
                            <label className="flex items-center gap-2 col-span-2">
                                <input
                                    type="checkbox"
                                    checked={form.publish}
                                    onChange={e => set('publish', e.target.checked)}
                                />
                                创建后立即发布（Shop 可见）
                            </label>
                            <div className="col-span-2">
                                <Button
                                    onClick={() => createMutation.mutate()}
                                    disabled={!form.inspector || (!form.orderCode && !form.rfqCode)}
                                >
                                    创建报告
                                </Button>
                            </div>
                        </div>
                    </Card>
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
