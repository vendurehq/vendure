import { defineDashboardExtension } from '@vendure/dashboard';

import { FormInputsTestPage } from './form-inputs-test-page';

defineDashboardExtension({
    routes: [
        {
            path: '/form-inputs-test',
            component: () => <FormInputsTestPage />,
        },
    ],
});
