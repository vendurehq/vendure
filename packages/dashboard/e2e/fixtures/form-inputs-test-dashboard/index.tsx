import { defineDashboardExtension } from '@vendure/dashboard';

import { FormInputsTestPage } from './form-inputs-test-page';
import { StartingValuesTestPage } from './starting-values-test-page';

defineDashboardExtension({
    routes: [
        {
            path: '/form-inputs-test',
            component: () => <FormInputsTestPage />,
        },
        {
            path: '/starting-values-test/$preset/$id',
            component: route => <StartingValuesTestPage route={route} />,
        },
    ],
});
