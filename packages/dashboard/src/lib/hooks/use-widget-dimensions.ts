import { WidgetContentContext } from '@/vdb/framework/dashboard-widget/base-widget.js';
import { useLingui } from '@lingui/react/macro';
import { useContext } from 'react';

export const useWidgetDimensions = () => {
    const { t } = useLingui();
    const context = useContext(WidgetContentContext);
    if (!context) {
        throw new Error(t`useWidgetDimensions must be used within a DashboardBaseWidget`);
    }
    return context;
};
