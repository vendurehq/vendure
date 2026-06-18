import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import { NodeType } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

export function markActive(state, type) {
    const { from, $from, to, empty } = state.selection;
    if (empty) {
        return type.isInSet(state.storedMarks || $from.marks());
    } else {
        return state.doc.rangeHasMark(from, to, type);
    }
}

export function canInsert(state: EditorState, nodeType: NodeType): boolean {
    const $from = state.selection.$from;
    for (let d = $from.depth; d >= 0; d--) {
        const index = $from.index(d);
        if ($from.node(d).canReplaceWith(index, index, nodeType)) {
            return true;
        }
    }
    return false;
}

export interface ClarityIconOptions {
    shape: string;
    size?: number;
    label?: string;
}

export function renderClarityIcon(options: ClarityIconOptions): (view: EditorView) => HTMLElement {
    return (view: EditorView) => {
        const icon = document.createElement('clr-icon');
        icon.setAttribute('shape', options.shape);
        icon.setAttribute('size', (options.size ?? IconSize.Small).toString());
        const labelEl = document.createElement('span');
        labelEl.textContent = options.label ?? '';
        return wrapInMenuItemWithIcon(icon, options.label ? labelEl : undefined);
    };
}

export function wrapInMenuItemWithIcon(...elements: Array<HTMLElement | undefined | null>) {
    const wrapperEl = document.createElement('span');
    wrapperEl.classList.add('menu-item-with-icon');
    wrapperEl.append(...elements.filter(notNullOrUndefined));
    return wrapperEl;
}

export const IconSize = {
    Large: 22,
    Small: 16,
};
