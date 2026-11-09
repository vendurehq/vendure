import { api, Button, Card, graphql, Page, PageBlock, PageLayout, PageTitle, toast } from '@vendure/dashboard';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

const customsDetailDocument = graphql(`
    query OnebridgeCustomsDetail($orderCode: String!) {
        onebridgeCustomsRecord(orderCode: $orderCode) {
            id
            orderCode
            customsStatus
            declaredAt
            clearedAt
            declarationNo
            hsCode
            note
            docs
            lastSyncedAt
        }
    }
`);

const upsertCustomsDocument = graphql(`
    mutation UpsertOnebridgeCustoms($input: CustomsRecordInput!) {
        upsertOnebridgeCustomsRecord(input: $input) {
            id
            orderCode
            customsStatus
        }
    }
`);

const STATUSES = ['not_started', 'docs_preparing', 'declared', 'inspecting', 'cleared', 'hold'];

export function OnebridgeCustomsDetailPage({ route }: { route: any }) {
    const { orderCode } = route.useParams();
    const queryClient = useQueryClient();
    const [form, setForm] = useState<any>({
        customsStatus: 'docs_preparing',
        declarationNo: '',
        hsCode: '',
        note: '',
        idempotencyKey: '',
    });

    const { data } = useQuery({
        queryKey: ['onebridge-customs', orderCode],
        queryFn: () => api.query(customsDetailDocument, { orderCode }),
    });
    const record: any = (data as any)?.onebridgeCustomsRecord;

    const saveMutation = useMutation({
        mutationFn: () =>
            api.mutate(upsertCustomsDocument, {
                input: {
                    orderCode,
                    customsStatus: form.customsStatus,
                    declarationNo: form.declarationNo || null,
                    hsCode: form.hsCode || null,
                    note: form.note || null,
                    idempotencyKey: form.idempotencyKey || null,
                },
            }),
        onSuccess: () => {
            toast.success('清关状态已回写');
            queryClient.invalidateQueries({ queryKey: ['onebridge-customs', orderCode] });
            setForm((prev: any) => ({ ...prev, idempotencyKey: '' }));
        },
        onError: (e: any) => toast.error(`回写失败: ${e.message}`),
    });

    const set = (key: string, value: any) => setForm((prev: any) => ({ ...prev, [key]: value }));

    return (
        <Page pageId="onebridge-customs-detail">
            <PageTitle>清关 · {orderCode}</PageTitle>
            <PageLayout>
                <PageBlock column="main" blockId="onebridge-customs-current">
                    <Card>
                        <div className="grid grid-cols-2 gap-3 p-4 text-sm">
                            <div>
                                <div className="text-muted-foreground">当前状态</div>
                                <div>{record?.customsStatus ?? '未创建记录'}</div>
                            </div>
                            <div>
                                <div className="text-muted-foreground">报关单号</div>
                                <div>{record?.declarationNo ?? '—'}</div>
                            </div>
                            <div>
                                <div className="text-muted-foreground">申报时间</div>
                                <div>{record?.declaredAt ?? '—'}</div>
                            </div>
                            <div>
                                <div className="text-muted-foreground">放行时间</div>
                                <div>{record?.clearedAt ?? '—'}</div>
                            </div>
                            <div className="col-span-2">
                                <div className="text-muted-foreground">备注</div>
                                <div>{record?.note ?? '—'}</div>
                            </div>
                        </div>
                    </Card>
                </PageBlock>

                <PageBlock column="main" blockId="onebridge-customs-upsert">
                    <Card>
                        <div className="grid grid-cols-2 gap-3 p-4 text-sm">
                            <label className="flex flex-col gap-1">
                                回写状态
                                <select
                                    className="border rounded px-2 py-1"
                                    value={form.customsStatus}
                                    onChange={e => set('customsStatus', e.target.value)}
                                >
                                    {STATUSES.map(x => (
                                        <option key={x} value={x}>
                                            {x}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1">
                                HS Code
                                <input
                                    className="border rounded px-2 py-1"
                                    value={form.hsCode}
                                    onChange={e => set('hsCode', e.target.value)}
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                报关单号
                                <input
                                    className="border rounded px-2 py-1"
                                    value={form.declarationNo}
                                    onChange={e => set('declarationNo', e.target.value)}
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                幂等键（可选）
                                <input
                                    className="border rounded px-2 py-1"
                                    value={form.idempotencyKey}
                                    onChange={e => set('idempotencyKey', e.target.value)}
                                />
                            </label>
                            <label className="flex flex-col gap-1 col-span-2">
                                备注
                                <textarea
                                    className="border rounded px-2 py-1"
                                    rows={2}
                                    value={form.note}
                                    onChange={e => set('note', e.target.value)}
                                />
                            </label>
                            <div className="col-span-2">
                                <Button onClick={() => saveMutation.mutate()}>回写清关状态</Button>
                            </div>
                        </div>
                    </Card>
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
