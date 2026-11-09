import { Button, graphql, ListPage, PageActionBarRight } from '@vendure/dashboard';
import { Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';

const contentListDocument = graphql(`
    query OnebridgeContentList($options: ContentListOptions) {
        onebridgeContentEntries(options: $options) {
            totalItems
            items {
                id
                slug
                contentType
                needType
                titleKr
                titleCn
                published
                sort
                updatedAt
            }
        }
    }
`);

export function OnebridgeContentListPage({ route }: { route: any }) {
    return (
        <ListPage
            pageId="onebridge-content-list"
            title="跨境内容"
            listQuery={contentListDocument}
            route={route}
            customizeColumns={{
                slug: {
                    header: '标识',
                    cell: ({ row }: any) => <Link to={`/onebridge/content/${row.original.id}`}>{row.original.slug}</Link>,
                },
                contentType: { header: '类型' },
                needType: { header: '归属' },
                titleKr: { header: '韩文标题（可能待补）' },
                titleCn: { header: '中文标题' },
                published: { header: '已发布' },
                sort: { header: '排序' },
            }}
        >
            <PageActionBarRight>
                <Button render={<Link to="/onebridge/content/new" />}>
                    <PlusIcon className="mr-1 h-4 w-4" /> 新建
                </Button>
            </PageActionBarRight>
        </ListPage>
    );
}
