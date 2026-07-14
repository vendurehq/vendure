import { createCrudTestSuite } from '../../utils/crud-test-factory.js';

createCrudTestSuite({
    entityName: 'option group',
    entityNamePlural: 'option groups',
    listPath: '/option-groups',
    listTitle: 'Option Groups',
    newButtonLabel: 'New option group',
    newPageTitle: 'New option group',
    createFields: [{ label: 'Name', value: 'E2E Test Material' }],
    afterFillCreate: async (page, detail) => {
        // Click the "Edit slug manually" button to unlock the Code field,
        // then fill it explicitly. This avoids timing issues with the
        // SlugInput's async auto-generation via API + useEffect.
        const codeItem = detail.formItem('Code');
        await codeItem.getByRole('button', { name: 'Edit slug manually' }).click();
        await codeItem.getByRole('textbox').fill('e2e-test-material');
    },
});
