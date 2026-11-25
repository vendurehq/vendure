import type { AnchorSpec } from './recorder.js';

const TABLE = '[data-slot="data-table"]';

/** The anchors of a list page: title row, toolbar, header cells, first and last row, footer, content height. */
export const LIST_PAGE_ANCHORS: AnchorSpec[] = [
    {
        key: 'title',
        display: 'title row',
        selector: '[data-slot="page-header"]',
        props: ['x', 'y', 'width', 'height'],
    },
    {
        key: 'toolbar',
        display: 'toolbar',
        selector: `${TABLE} [data-slot="card-header"]`,
        props: ['x', 'y', 'width', 'height'],
    },
    {
        key: 'header',
        display: 'table header',
        selector: `${TABLE} thead th`,
        props: ['x', 'y', 'width', 'height'],
        each: 'text',
    },
    {
        key: 'row',
        display: 'row',
        selector: `${TABLE} tbody > tr`,
        props: ['y', 'height'],
        each: 'index',
        firstAndLast: true,
    },
    { key: 'body', display: 'table body', selector: `${TABLE} tbody`, props: ['y', 'height'] },
    {
        key: 'footer',
        display: 'footer',
        selector: `${TABLE} [data-slot="card-footer"]`,
        props: ['x', 'y', 'width', 'height'],
    },
    {
        key: 'content',
        display: 'main content',
        selector: 'main[data-slot="app-shell-main"] > div',
        props: ['height'],
        scrollHeight: true,
    },
];

/** Every row by index, for scenarios where the rule depends on a row's position (delete). */
export const EVERY_ROW: AnchorSpec = {
    key: 'rows',
    display: 'row',
    selector: `${TABLE} tbody > tr`,
    props: ['y', 'height'],
    each: 'index',
};
