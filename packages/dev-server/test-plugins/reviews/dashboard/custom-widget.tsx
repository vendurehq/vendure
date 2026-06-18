import { DashboardBaseWidget } from '@vendure/dashboard';

export function CustomWidget() {
    return (
        <DashboardBaseWidget id="custom-widget" title="Custom Widget" description="This is a custom widget">
            <div>Hello from the reviews plugin</div>
        </DashboardBaseWidget>
    );
}
