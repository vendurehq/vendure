import { api, Button, Card, graphql, Page, PageBlock, PageLayout, PageTitle, toast } from '@vendure/dashboard';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

const contentDetailDocument = graphql(`
    query OnebridgeContentDetail($options: ContentListOptions) {
        onebridgeContentEntries(options: $options) {
            items {
                id
                slug
                contentType
                needType
                titleKr
                titleCn
                bodyKr
                bodyCn
                published
                sort
            }
        }
    }
`);

const saveContentDocument = graphql(`
    mutation SaveOnebridgeContent($input: OnebridgeContentInput!) {
        saveOnebridgeContentEntry(input: $input) {
            id
            slug
        }
    }
`);

const CONTENT_TYPES = ['column', 'case', 'logistics_channel', 'site_block'];
const NEED_TYPES = ['logistics', 'daily', 'collections', 'projects'];

export function OnebridgeContentDetailPage({ route }: { route: any }) {
    const { id } = route.useParams();
    const isNew = id === 'new';
    const queryClient = useQueryClient();
    const [form, setForm] = useState<any>({
        contentType: 'site_block',
        slug: '',
        needType: '',
        titleKr: '',
        titleCn: '',
        bodyKr: '',
        bodyCn: '',
        published: false,
        sort: 0,
    });

    useQuery({
        queryKey: ['onebridge-content-detail', id],
        enabled: !isNew,
        queryFn: async () => {
            const result: any = await api.query(contentDetailDocument as any, { options: { take: 100 } });
            const entry = result.onebridgeContentEntries.items.find((x: any) => String(x.id) === String(id));
            if (entry) setForm({ ...entry, needType: entry.needType ?? '' });
            return result;
        },
    });

    const saveMutation = useMutation({
        mutationFn: () =>
            api.mutate(saveContentDocument, {
                input: {
                    ...(isNew ? {} : { id }),
                    contentType: form.contentType,
                    slug: form.slug,
                    needType: form.needType || null,
                    titleKr: form.titleKr,
                    titleCn: form.titleCn || null,
                    bodyKr: form.bodyKr || null,
                    bodyCn: form.bodyCn || null,
                    published: !!form.published,
                    sort: Number(form.sort ?? 0),
                },
            }),
        onSuccess: () => {
            toast.success('内容已保存');
            queryClient.invalidateQueries({ queryKey: ['onebridge-content-list'] });
        },
        onError: (e: any) => toast.error(`保存失败: ${e.message}`),
    });

    const set = (key: string, value: any) => setForm((prev: any) => ({ ...prev, [key]: value }));

    return (
        <Page pageId="onebridge-content-detail">
            <PageTitle>{isNew ? '新建内容' : `内容 #${id}`}</PageTitle>
            <PageLayout>
                <PageBlock column="main" blockId="onebridge-content-form">
                    <Card>
                        <div className="grid grid-cols-2 gap-3 p-4 text-sm">
                            <label className="flex flex-col gap-1">
                                类型
                                <select
                                    className="border rounded px-2 py-1"
                                    value={form.contentType}
                                    onChange={e => set('contentType', e.target.value)}
                                >
                                    {CONTENT_TYPES.map(x => (
                                        <option key={x} value={x}>
                                            {x}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1">
                                归属
                                <select
                                    className="border rounded px-2 py-1"
                                    value={form.needType}
                                    onChange={e => set('needType', e.target.value)}
                                >
                                    <option value="">无</option>
                                    {NEED_TYPES.map(x => (
                                        <option key={x} value={x}>
                                            {x}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1">
                                标识 slug
                                <input
                                    className="border rounded px-2 py-1"
                                    value={form.slug}
                                    onChange={e => set('slug', e.target.value)}
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                排序
                                <input
                                    className="border rounded px-2 py-1"
                                    type="number"
                                    value={form.sort}
                                    onChange={e => set('sort', e.target.value)}
                                />
                            </label>
                            <label className="flex flex-col gap-1 col-span-2">
                                韩文标题（待补，勿自造）
                                <input
                                    className="border rounded px-2 py-1"
                                    value={form.titleKr}
                                    onChange={e => set('titleKr', e.target.value)}
                                />
                            </label>
                            <label className="flex flex-col gap-1 col-span-2">
                                中文标题
                                <input
                                    className="border rounded px-2 py-1"
                                    value={form.titleCn}
                                    onChange={e => set('titleCn', e.target.value)}
                                />
                            </label>
                            <label className="flex flex-col gap-1 col-span-2">
                                韩文正文（待补）
                                <textarea
                                    className="border rounded px-2 py-1"
                                    rows={3}
                                    value={form.bodyKr}
                                    onChange={e => set('bodyKr', e.target.value)}
                                />
                            </label>
                            <label className="flex flex-col gap-1 col-span-2">
                                中文正文
                                <textarea
                                    className="border rounded px-2 py-1"
                                    rows={3}
                                    value={form.bodyCn}
                                    onChange={e => set('bodyCn', e.target.value)}
                                />
                            </label>
                            <label className="flex items-center gap-2 col-span-2">
                                <input
                                    type="checkbox"
                                    checked={!!form.published}
                                    onChange={e => set('published', e.target.checked)}
                                />
                                发布
                            </label>
                            <div className="col-span-2">
                                <Button onClick={() => saveMutation.mutate()} disabled={!form.slug || !form.titleKr}>
                                    保存
                                </Button>
                            </div>
                        </div>
                    </Card>
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
