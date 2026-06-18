import { Plugin, TextSelection } from 'prosemirror-state';

import { getMarkRange } from '../utils';

/**
 * Causes the entire link to be selected when clicked.
 */
export const linkSelectPlugin = new Plugin({
    props: {
        handleClick(view, pos) {
            const { doc, tr, schema } = view.state;
            const range = getMarkRange(doc.resolve(pos), schema.marks.link);
            if (!range) {
                return false;
            }

            const $start = doc.resolve(range.from);
            const $end = doc.resolve(range.to);
            const transaction = tr.setSelection(new TextSelection($start, $end));

            view.dispatch(transaction);
            return true;
        },
    },
});
