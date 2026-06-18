import { Injector } from '@angular/core';
import { menuBar } from 'prosemirror-menu';
import { Schema } from 'prosemirror-model';
import { EditorState, Plugin } from 'prosemirror-state';

import { ModalService } from '../../../../../providers/modal/modal.service';

import { buildMenuItems } from './menu';

export interface CustomMenuPluginOptions {
    floatingMenu?: boolean;
    schema: Schema;
    injector: Injector;
}

export function customMenuPlugin(options: CustomMenuPluginOptions) {
    const modalService = options.injector.get(ModalService);
    const pmMenuBarPlugin = menuBar({
        floating: options.floatingMenu !== false,
        content: buildMenuItems(options.schema, modalService).fullMenu,
    });
    return pmMenuBarPlugin;
}
