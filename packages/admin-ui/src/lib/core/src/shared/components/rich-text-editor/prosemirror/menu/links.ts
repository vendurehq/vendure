import { toggleMark } from 'prosemirror-commands';
import { icons, MenuItem } from 'prosemirror-menu';
import { MarkType } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';

import { ModalService } from '../../../../../providers/modal/modal.service';
import { LinkAttrs, LinkDialogComponent } from '../../link-dialog/link-dialog.component';

import { markActive, renderClarityIcon } from './menu-common';

function selectionIsWithinLink(state: EditorState, anchor: number, head: number): boolean {
    const { doc } = state;
    const headLink = doc
        .resolve(head)
        .marks()
        .find(m => m.type.name === 'link');
    const anchorLink = doc
        .resolve(anchor)
        .marks()
        .find(m => m.type.name === 'link');
    if (headLink && anchorLink && headLink.eq(anchorLink)) {
        return true;
    }
    return false;
}

export function linkItem(linkMark: MarkType, modalService: ModalService) {
    return new MenuItem({
        title: 'Add or remove link',
        render: renderClarityIcon({ shape: 'link', size: 22 }),
        class: '',
        css: '',
        active(state) {
            return markActive(state, linkMark);
        },
        enable(state) {
            const { selection } = state;
            return !selection.empty || selectionIsWithinLink(state, selection.anchor, selection.head);
        },
        run(state: EditorState, dispatch, view) {
            let attrs: LinkAttrs | undefined;
            const { selection, doc } = state;
            if (
                selection instanceof TextSelection &&
                selectionIsWithinLink(state, selection.anchor + 1, selection.head - 1)
            ) {
                const mark = doc
                    .resolve(selection.anchor + 1)
                    .marks()
                    .find(m => m.type.name === 'link');
                if (mark) {
                    attrs = mark.attrs as LinkAttrs;
                }
            }
            modalService
                .fromComponent(LinkDialogComponent, {
                    closable: true,
                    locals: {
                        existing: attrs,
                    },
                })
                .subscribe(result => {
                    let tr = state.tr;
                    if (result) {
                        const { $from, $to } = selection.ranges[0];
                        tr = tr.removeMark($from.pos, $to.pos, linkMark);
                        if (result.href !== '') {
                            tr = tr.addMark($from.pos, $to.pos, linkMark.create(result));
                        }
                    }
                    dispatch(tr.scrollIntoView());
                    view.focus();
                });
            return true;
        },
    });
}
