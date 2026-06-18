import { MenuItem } from 'prosemirror-menu';
import { Schema } from 'prosemirror-model';

export interface SetupOptions {
    schema: Schema;
    mapKeys?: Keymap;
    menuBar?: boolean;
    history?: boolean;
    floatingMenu?: boolean;
}

export type Keymap = Record<string, string | false>;
