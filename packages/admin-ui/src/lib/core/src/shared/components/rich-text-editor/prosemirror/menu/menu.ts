import { toggleMark } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import {
    blockTypeItem,
    Dropdown,
    icons,
    joinUpItem,
    liftItem,
    MenuItem,
    selectParentNodeItem,
    wrapItem,
} from 'prosemirror-menu';
import { MarkType, NodeType, Schema } from 'prosemirror-model';
import { wrapInList } from 'prosemirror-schema-list';
import { EditorState } from 'prosemirror-state';

import { ModalService } from '../../../../../providers/modal/modal.service';
import { insertImageItem } from '../plugins/image-plugin';
import { addTable } from '../plugins/tables-plugin';

import { linkItem } from './links';
import { canInsert, IconSize, markActive, renderClarityIcon, wrapInMenuItemWithIcon } from './menu-common';
import { SubMenuWithIcon } from './sub-menu-with-icon';

// Helpers to create specific types of items

type CmdItemOptions = Record<string, any> & { iconShape?: string };

function cmdItem(cmd: (...args: any[]) => void, options: CmdItemOptions) {
    const passedOptions = {
        label: options.title,
        run: cmd,
        render: options.iconShape
            ? renderClarityIcon({ shape: options.iconShape, size: IconSize.Large })
            : undefined,
    };
    // eslint-disable-next-line guard-for-in
    for (const prop in options) {
        passedOptions[prop] = options[prop];
    }
    if ((!options.enable || options.enable === true) && !options.select) {
        passedOptions[options.enable ? 'enable' : 'select'] = state => cmd(state);
    }

    return new MenuItem(passedOptions as any);
}

function markItem(markType, options: CmdItemOptions) {
    const passedOptions = {
        active(state) {
            return markActive(state, markType);
        },
        enable: true,
    };
    // eslint-disable-next-line guard-for-in
    for (const prop in options) {
        passedOptions[prop] = options[prop];
    }
    return cmdItem(toggleMark(markType), passedOptions);
}

function wrapListItem(nodeType, options: CmdItemOptions) {
    return cmdItem(wrapInList(nodeType, options.attrs), options);
}

// :: (Schema) → Object
// Given a schema, look for default mark and node types in it and
// return an object with relevant menu items relating to those marks:
//
// **`toggleStrong`**`: MenuItem`
//   : A menu item to toggle the [strong mark](#schema-basic.StrongMark).
//
// **`toggleEm`**`: MenuItem`
//   : A menu item to toggle the [emphasis mark](#schema-basic.EmMark).
//
// **`toggleCode`**`: MenuItem`
//   : A menu item to toggle the [code font mark](#schema-basic.CodeMark).
//
// **`toggleLink`**`: MenuItem`
//   : A menu item to toggle the [link mark](#schema-basic.LinkMark).
//
// **`insertImage`**`: MenuItem`
//   : A menu item to insert an [image](#schema-basic.Image).
//
// **`wrapBulletList`**`: MenuItem`
//   : A menu item to wrap the selection in a [bullet list](#schema-list.BulletList).
//
// **`wrapOrderedList`**`: MenuItem`
//   : A menu item to wrap the selection in an [ordered list](#schema-list.OrderedList).
//
// **`wrapBlockQuote`**`: MenuItem`
//   : A menu item to wrap the selection in a [block quote](#schema-basic.BlockQuote).
//
// **`makeParagraph`**`: MenuItem`
//   : A menu item to set the current textblock to be a normal
//     [paragraph](#schema-basic.Paragraph).
//
// **`makeCodeBlock`**`: MenuItem`
//   : A menu item to set the current textblock to be a
//     [code block](#schema-basic.CodeBlock).
//
// **`makeHead[N]`**`: MenuItem`
//   : Where _N_ is 1 to 6. Menu items to set the current textblock to
//     be a [heading](#schema-basic.Heading) of level _N_.
//
// **`insertHorizontalRule`**`: MenuItem`
//   : A menu item to insert a horizontal rule.
//
// The return value also contains some prefabricated menu elements and
// menus, that you can use instead of composing your own menu from
// scratch:
//
// **`insertMenu`**`: Dropdown`
//   : A dropdown containing the `insertImage` and
//     `insertHorizontalRule` items.
//
// **`typeMenu`**`: Dropdown`
//   : A dropdown containing the items for making the current
//     textblock a paragraph, code block, or heading.
//
// **`fullMenu`**`: [[MenuElement]]`
//   : An array of arrays of menu elements for use as the full menu
//     for, for example the [menu bar](https://github.com/prosemirror/prosemirror-menu#user-content-menubar).
export function buildMenuItems(schema: Schema, modalService: ModalService) {
    const r: Record<string, any> = {};
    let type: MarkType | NodeType;

    type = schema.marks.strong;
    if (type) {
        r.toggleStrong = markItem(type, {
            title: 'Toggle strong style',
            iconShape: 'bold',
        });
    }

    type = schema.marks.em;
    if (type) {
        r.toggleEm = markItem(type, {
            title: 'Toggle emphasis',
            iconShape: 'italic',
        });
    }

    type = schema.marks.code;
    if (type) {
        r.toggleCode = markItem(type, { title: 'Toggle code font', icon: icons.code });
    }

    type = schema.marks.link;
    if (type) {
        r.toggleLink = linkItem(type, modalService);
    }

    type = schema.nodes.image;
    if (type) {
        r.insertImage = insertImageItem(type, modalService);
    }

    type = schema.nodes.bullet_list;
    if (type) {
        r.wrapBulletList = wrapListItem(type, {
            title: 'Wrap in bullet list',
            iconShape: 'bullet-list',
        });
    }

    type = schema.nodes.ordered_list;
    if (type) {
        r.wrapOrderedList = wrapListItem(type, {
            title: 'Wrap in ordered list',
            iconShape: 'number-list',
        });
    }

    type = schema.nodes.blockquote;
    if (type) {
        r.wrapBlockQuote = wrapItem(type, {
            title: 'Wrap in block quote',
            render: renderClarityIcon({ shape: 'block-quote', size: IconSize.Large }),
        });
    }

    type = schema.nodes.paragraph;
    if (type) {
        r.makeParagraph = blockTypeItem(type, {
            title: 'Change to paragraph',
            render: renderClarityIcon({ shape: 'text', label: 'Plain' }),
        });
    }

    type = schema.nodes.code_block;
    if (type) {
        r.makeCodeBlock = blockTypeItem(type, {
            title: 'Change to code block',
            render: renderClarityIcon({ shape: 'code', label: 'Code' }),
        });
    }

    type = schema.nodes.heading;
    if (type) {
        for (let i = 1; i <= 10; i++) {
            r['makeHead' + i] = blockTypeItem(type, {
                title: 'Change to heading ' + i,
                label: 'Level ' + i,
                attrs: { level: i },
            });
        }
    }

    type = schema.nodes.horizontal_rule;
    if (type) {
        const hr = type;
        r.insertHorizontalRule = new MenuItem({
            title: 'Insert horizontal rule',
            render: view => {
                const icon = document.createElement('div');
                icon.classList.add('custom-icon', 'hr-icon');
                const labelEl = document.createElement('span');
                labelEl.textContent = 'Horizontal rule';
                return wrapInMenuItemWithIcon(icon, labelEl);
            },
            enable(state) {
                return canInsert(state, hr);
            },
            run(state: EditorState, dispatch) {
                dispatch(state.tr.replaceSelectionWith(hr.create()));
            },
        });
    }

    const cut = <T>(arr: T[]): T[] => arr.filter(x => x);
    r.insertMenu = new Dropdown(
        cut([
            r.insertImage,
            r.insertHorizontalRule,
            new MenuItem({
                run: (state, dispatch) => {
                    addTable(state, dispatch, {
                        rowsCount: 2,
                        colsCount: 2,
                        withHeaderRow: true,
                        cellContent: '',
                    });
                },
                render: renderClarityIcon({ shape: 'table', label: 'Table' }),
            }),
        ]),
        { label: 'Insert' },
    );
    r.typeMenu = new Dropdown(
        cut([
            r.makeParagraph,
            r.makeCodeBlock,
            r.makeHead1 &&
                new SubMenuWithIcon(
                    cut([r.makeHead1, r.makeHead2, r.makeHead3, r.makeHead4, r.makeHead5, r.makeHead6]),
                    {
                        label: 'Heading',
                        icon: () => {
                            const icon = document.createElement('div');
                            icon.textContent = 'H';
                            icon.classList.add('custom-icon', 'h-icon');
                            return icon;
                        },
                    },
                ),
        ]),
        { label: 'Type...' },
    );

    const inlineMenu = cut([r.toggleStrong, r.toggleEm, r.toggleLink]);
    r.inlineMenu = [inlineMenu];
    r.blockMenu = [
        cut([
            r.wrapBulletList,
            r.wrapOrderedList,
            r.wrapBlockQuote,
            joinUpItem,
            liftItem,
            selectParentNodeItem,
        ]),
    ];
    const undoRedo = [
        new MenuItem({
            title: 'Undo last change',
            run: undo,
            enable(state) {
                return undo(state);
            },
            render: renderClarityIcon({ shape: 'undo', size: IconSize.Large }),
        }),
        new MenuItem({
            title: 'Redo last undone change',
            run: redo,
            enable(state) {
                return redo(state);
            },
            render: renderClarityIcon({ shape: 'redo', size: IconSize.Large }),
        }),
    ];
    r.fullMenu = [inlineMenu].concat([[r.insertMenu, r.typeMenu]], [undoRedo], r.blockMenu);

    return r;
}
