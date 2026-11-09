import {
    api,
    Button,
    Card,
    graphql,
    Page,
    PageBlock,
    PageLayout,
    PageTitle,
    toast,
} from '@vendure/dashboard';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

const rfqDetailDocument = graphql(`
    query OnebridgeRfqDetail($id: ID) {
        onebridgeRfq(id: $id) {
            id
            code
            needType
            needLabel
            stage
            businessLine
            assignedTeam
            customerName
            customerContact
            customer {
                name
                contact
                locale
            }
            requirement {
                item
                qty
                eta
                memo
            }
            quote {
                amount
                currency
                validUntil
                note
            }
            sample {
                status
                trackingNo
                confirmedAt
            }
            timeline {
                stage
                title
                desc
                state
                time
            }
            createdAt
        }
    }
`);

const saveQuoteDocument = graphql(`
    mutation SaveOnebridgeRfqQuote($rfqId: ID!, $input: RfqQuoteInput!) {
        saveRfqQuote(rfqId: $rfqId, input: $input) {
            amount
            currency
        }
    }
`);

const saveSampleDocument = graphql(`
    mutation SaveOnebridgeRfqSample($rfqId: ID!, $input: RfqSampleInput!) {
        saveRfqSample(rfqId: $rfqId, input: $input) {
            status
            trackingNo
        }
    }
`);

const transitionDocument = graphql(`
    mutation TransitionOnebridgeRfq($rfqId: ID!, $stage: CrossBorderStage!) {
        transitionRfqStage(rfqId: $rfqId, stage: $stage) {
            id
            stage
        }
    }
`);

const NEXT_STAGES = [
    'wait_pay',
    'quoting',
    'requirement',
    'sourcing',
    'risk',
    'sample',
    'producing',
    'shipping',
    'qc',
    'refund',
    'delivered',
    'customs',
    'done',
    'lost',
];

export function OnebridgeRfqDetailPage({ route }: { route: any }) {
    const { id } = route.useParams();
    const queryClient = useQueryClient();
    const [amount, setAmount] = useState('');
    const [sampleStatus, setSampleStatus] = useState('');
    const [trackingNo, setTrackingNo] = useState('');
    const [stage, setStage] = useState('');

    const { data, isLoading } = useQuery({
        queryKey: ['onebridge-rfq', id],
        queryFn: () => api.query(rfqDetailDocument, { id }),
    });
    const rfq: any = (data as any)?.onebridgeRfq;

    const quoteMutation = useMutation({
        mutationFn: () =>
            api.mutate(saveQuoteDocument, {
                rfqId: id,
                input: { amount: Number(amount), currency: 'KRW', note: '后台报价' },
            }),
        onSuccess: () => {
            toast.success('报价已保存');
            queryClient.invalidateQueries({ queryKey: ['onebridge-rfq', id] });
            setAmount('');
        },
        onError: (e: any) => toast.error(`报价保存失败: ${e.message}`),
    });

    const sampleMutation = useMutation({
        mutationFn: () =>
            api.mutate(saveSampleDocument, {
                rfqId: id,
                input: { status: sampleStatus, trackingNo: trackingNo || null },
            }),
        onSuccess: () => {
            toast.success('样品信息已保存');
            queryClient.invalidateQueries({ queryKey: ['onebridge-rfq', id] });
        },
        onError: (e: any) => toast.error(`样品保存失败: ${e.message}`),
    });

    const transitionMutation = useMutation({
        mutationFn: () => api.mutate(transitionDocument, { rfqId: id, stage }),
        onSuccess: () => {
            toast.success('阶段已跃迁');
            queryClient.invalidateQueries({ queryKey: ['onebridge-rfq', id] });
            setStage('');
        },
        onError: (e: any) => toast.error(`跃迁失败: ${e.message}`),
    });

    if (isLoading) return <div className="p-6">加载中...</div>;
    if (!rfq) return <div className="p-6">未找到 RFQ</div>;

    return (
        <Page pageId="onebridge-rfq-detail">
            <PageTitle>{rfq.code}</PageTitle>
            <PageLayout>
                <PageBlock column="main" blockId="onebridge-rfq-summary">
                    <Card>
                        <div className="grid grid-cols-2 gap-4 p-4 text-sm">
                            <div>
                                <div className="text-muted-foreground">需求</div>
                                <div>{rfq.needLabel}</div>
                            </div>
                            <div>
                                <div className="text-muted-foreground">当前阶段</div>
                                <div>{rfq.stage}</div>
                            </div>
                            <div>
                                <div className="text-muted-foreground">客户</div>
                                <div>
                                    {rfq.customerName} / {rfq.customerContact}
                                </div>
                            </div>
                            <div>
                                <div className="text-muted-foreground">业务线</div>
                                <div>{rfq.businessLine ?? '—'}</div>
                            </div>
                            <div className="col-span-2">
                                <div className="text-muted-foreground">需求内容</div>
                                <div>{rfq.requirement?.item}</div>
                                <div className="text-xs text-muted-foreground">
                                    qty={rfq.requirement?.qty ?? '—'} / eta={rfq.requirement?.eta ?? '—'}
                                </div>
                                {rfq.requirement?.memo ? <div>{rfq.requirement.memo}</div> : null}
                            </div>
                        </div>
                    </Card>
                </PageBlock>

                <PageBlock column="main" blockId="onebridge-rfq-quote">
                    <Card>
                        <div className="p-4">
                            <h3 className="mb-3 font-semibold">报价</h3>
                            <div className="mb-3 text-sm">
                                当前: {rfq.quote ? `${rfq.quote.amount} ${rfq.quote.currency}` : '—'}
                            </div>
                            <div className="flex gap-2">
                                <input
                                    className="border rounded px-2 py-1 flex-1"
                                    placeholder="报价金额（KRW）"
                                    value={amount}
                                    onChange={e => setAmount(e.target.value)}
                                />
                                <Button onClick={() => quoteMutation.mutate()} disabled={!amount}>
                                    保存报价
                                </Button>
                            </div>
                        </div>
                    </Card>
                </PageBlock>

                <PageBlock column="main" blockId="onebridge-rfq-sample">
                    <Card>
                        <div className="p-4">
                            <h3 className="mb-3 font-semibold">样品</h3>
                            <div className="mb-3 text-sm">
                                当前: {rfq.sample ? `${rfq.sample.status} / ${rfq.sample.trackingNo ?? '—'}` : '—'}
                            </div>
                            <div className="flex gap-2">
                                <input
                                    className="border rounded px-2 py-1"
                                    placeholder="样品状态"
                                    value={sampleStatus}
                                    onChange={e => setSampleStatus(e.target.value)}
                                />
                                <input
                                    className="border rounded px-2 py-1"
                                    placeholder="运单号"
                                    value={trackingNo}
                                    onChange={e => setTrackingNo(e.target.value)}
                                />
                                <Button onClick={() => sampleMutation.mutate()} disabled={!sampleStatus}>
                                    保存样品
                                </Button>
                            </div>
                        </div>
                    </Card>
                </PageBlock>

                <PageBlock column="main" blockId="onebridge-rfq-transition">
                    <Card>
                        <div className="p-4">
                            <h3 className="mb-3 font-semibold">阶段跃迁</h3>
                            <div className="flex gap-2">
                                <select
                                    className="border rounded px-2 py-1"
                                    value={stage}
                                    onChange={e => setStage(e.target.value)}
                                >
                                    <option value="">选择目标阶段</option>
                                    {NEXT_STAGES.map(s => (
                                        <option key={s} value={s}>
                                            {s}
                                        </option>
                                    ))}
                                </select>
                                <Button onClick={() => transitionMutation.mutate()} disabled={!stage}>
                                    执行跃迁
                                </Button>
                            </div>
                        </div>
                    </Card>
                </PageBlock>

                <PageBlock column="main" blockId="onebridge-rfq-timeline">
                    <Card>
                        <div className="p-4">
                            <h3 className="mb-3 font-semibold">时间轴</h3>
                            <div className="space-y-2">
                                {rfq.timeline.map((event: any, index: number) => (
                                    <div key={`${event.stage}-${index}`} className="text-sm">
                                        <span className="mr-2 text-muted-foreground">{event.time ?? '—'}</span>
                                        <span className="font-medium">{event.title}</span>
                                        <span className="ml-2 text-muted-foreground">{event.state}</span>
                                        {event.desc ? <div className="text-muted-foreground">{event.desc}</div> : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </Card>
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
