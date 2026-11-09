import { defineDashboardExtension } from '@vendure/dashboard';

import { OnebridgeContentDetailPage } from './onebridge-content-detail';
import { OnebridgeContentListPage } from './onebridge-content-list';
import { OnebridgeCustomsDetailPage } from './onebridge-customs-detail';
import { OnebridgeCustomsListPage } from './onebridge-customs-list';
import { OnebridgeInspectionCreatePage } from './onebridge-inspection-create';
import { OnebridgeInspectionListPage } from './onebridge-inspection-list';
import { OnebridgeRfqDetailPage } from './onebridge-rfq-detail';
import { OnebridgeRfqListPage } from './onebridge-rfq-list';

export default defineDashboardExtension({
    routes: [
        {
            path: '/onebridge/rfqs',
            component: route => <OnebridgeRfqListPage route={route} />,
            navMenuItem: {
                id: 'onebridge-rfqs',
                title: '跨境询价',
                url: '/onebridge/rfqs',
                sectionId: 'sales',
                requiresPermission: 'OnebridgeRfqManage',
            },
        },
        {
            path: '/onebridge/rfqs/$id',
            component: route => <OnebridgeRfqDetailPage route={route} />,
        },
        {
            path: '/onebridge/content',
            component: route => <OnebridgeContentListPage route={route} />,
            navMenuItem: {
                id: 'onebridge-content',
                title: '跨境内容',
                url: '/onebridge/content',
                sectionId: 'marketing',
                requiresPermission: 'OnebridgeContentManage',
            },
        },
        {
            path: '/onebridge/content/$id',
            component: route => <OnebridgeContentDetailPage route={route} />,
        },
        {
            path: '/onebridge/inspections',
            component: route => <OnebridgeInspectionListPage route={route} />,
            navMenuItem: {
                id: 'onebridge-inspections',
                title: '跨境验货',
                url: '/onebridge/inspections',
                sectionId: 'sales',
                requiresPermission: 'OnebridgeInspectionManage',
            },
        },
        {
            path: '/onebridge/inspections/new',
            component: () => <OnebridgeInspectionCreatePage />,
        },
        {
            path: '/onebridge/customs',
            component: route => <OnebridgeCustomsListPage route={route} />,
            navMenuItem: {
                id: 'onebridge-customs',
                title: '跨境清关',
                url: '/onebridge/customs',
                sectionId: 'sales',
                requiresPermission: 'OnebridgeCustomsManage',
            },
        },
        {
            path: '/onebridge/customs/$orderCode',
            component: route => <OnebridgeCustomsDetailPage route={route} />,
        },
    ],
});
