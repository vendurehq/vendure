import { DropdownSubmenu, MenuElement } from 'prosemirror-menu';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import { wrapInMenuItemWithIcon } from './menu-common';

export class SubMenuWithIcon extends DropdownSubmenu {
    private icon: HTMLElement;
    constructor(
        content: readonly MenuElement[] | MenuElement,
        options: {
            label?: string;
            icon: () => HTMLElement;
        },
    ) {
        super(content, options);
        this.icon = options.icon();
    }
    render(view: EditorView): {
        dom: HTMLElement;
        update: (state: EditorState) => boolean;
    } {
        const { dom, update } = super.render(view);
        return {
            dom: wrapInMenuItemWithIcon(this.icon, dom),
            update,
        };
    }
}
