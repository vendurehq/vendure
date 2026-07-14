import { FileJson } from 'lucide-react';

import { Button } from '../ui/button.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu.js';
import { JsonViewer } from './json-viewer.js';

export function Json({ value }: Readonly<{ value: any }>) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="secondary" size="icon" />}>
                    <FileJson />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-96 max-h-96 overflow-auto p-2">
                <JsonViewer viewOnly data={value} collapse={1} rootFontSize={12} />
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
