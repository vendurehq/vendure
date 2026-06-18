import { addons } from 'storybook/manager-api';
import vendureTheme from './vendure-theme';

addons.setConfig({
    theme: vendureTheme,
    sidebar: {
        collapsedRoots: ['ui', 'form-inputs', 'layout', 'framework'],
    },
    layoutCustomisations: {},
});
