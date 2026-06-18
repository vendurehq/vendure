import { addNavMenuSection } from '@vendure/admin-ui/core';

export default [
    addNavMenuSection({
        id: 'ui-extensions-library',
        label: 'UI Extensions Library',
        items: [
            {
                id: 'react-ui',
                label: 'React UI',
                routerLink: ['/extensions/ui-library/react-ui'],
            },
            {
                id: 'angular-ui',
                label: 'Angular UI',
                routerLink: ['/extensions/ui-library/angular-ui'],
            },
        ],
    }),
];
