import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { PermissionDefinition } from '@vendure/admin-ui/core';

export interface PermissionGridRow {
    label: string;
    description: string;
    permissions: PermissionDefinition[];
}

/**
 * A table showing and allowing the setting of all possible CRUD permissions.
 */
@Component({
    selector: 'vdr-permission-grid',
    templateUrl: './permission-grid.component.html',
    styleUrls: ['./permission-grid.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class PermissionGridComponent implements OnInit {
    @Input() permissionDefinitions: PermissionDefinition[];
    @Input() activePermissions: string[];
    @Input() readonly = false;
    @Output() permissionChange = new EventEmitter<{ permission: string; value: boolean }>();
    gridData: PermissionGridRow[];

    ngOnInit() {
        this.buildGrid();
    }

    setPermission(permission: string, value: boolean) {
        if (!this.readonly) {
            this.permissionChange.emit({ permission, value });
        }
    }

    toggleAll(defs: PermissionDefinition[]) {
        const value = defs.some(d => !this.activePermissions.includes(d.name));
        for (const def of defs) {
            this.permissionChange.emit({ permission: def.name, value });
        }
    }

    private buildGrid() {
        const crudGroups = new Map<string, PermissionDefinition[]>();
        const nonCrud: PermissionDefinition[] = [];
        const crudRe = /^(Create|Read|Update|Delete)([a-zA-Z]+)$/;
        for (const def of this.permissionDefinitions) {
            const isCrud = crudRe.test(def.name);
            if (isCrud) {
                const groupName = def.name.match(crudRe)?.[2];
                if (groupName) {
                    const existing = crudGroups.get(groupName);
                    if (existing) {
                        existing.push(def);
                    } else {
                        crudGroups.set(groupName, [def]);
                    }
                }
            } else if (def.assignable) {
                nonCrud.push(def);
            }
        }
        this.gridData = [
            ...nonCrud.map(d => ({
                label: d.name,
                description: d.description,
                permissions: [d],
            })),
            ...Array.from(crudGroups.entries()).map(([label, defs]) => ({
                    label,
                    description: this.extractCrudDescription(defs[0]),
                    permissions: defs,
                })),
        ];
    }

    private extractCrudDescription(def: PermissionDefinition): string {
        return def.description.replace(/Grants permission to [\w]+/, 'Grants permissions on');
    }
}
