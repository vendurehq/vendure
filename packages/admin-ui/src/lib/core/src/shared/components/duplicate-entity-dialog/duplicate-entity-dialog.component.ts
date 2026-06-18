import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { assertNever } from '@vendure/common/lib/shared-utils';

import { lastValueFrom, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import {
    ConfigurableOperation,
    DuplicateEntityDocument,
    GetEntityDuplicatorsDocument,
    GetEntityDuplicatorsQuery,
} from '../../../common/generated-types';
import {
    configurableDefinitionToInstance,
    toConfigurableOperationInput,
} from '../../../common/utilities/configurable-operation-utils';
import { DataService } from '../../../data/providers/data.service';
import { Dialog } from '../../../providers/modal/modal.types';
import { NotificationService } from '../../../providers/notification/notification.service';

type EntityDuplicatorDef = GetEntityDuplicatorsQuery['entityDuplicators'][0];

@Component({
    selector: 'vdr-duplicate-entity-dialog',
    templateUrl: './duplicate-entity-dialog.component.html',
    styleUrls: ['./duplicate-entity-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class DuplicateEntityDialogComponent<T extends { id: string }> implements OnInit, Dialog<boolean> {
    resolveWith: (result?: boolean | undefined) => void;
    protected entityDuplicators$: Observable<EntityDuplicatorDef[]>;
    protected selectedDuplicator: EntityDuplicatorDef | undefined;
    protected duplicatorInstance: ConfigurableOperation;
    protected formGroup = new FormControl<ConfigurableOperation>({
        code: '',
        args: [],
    });

    title?: string;
    entities: T[];
    entityName: string;
    getEntityName: (entity: T) => string;

    constructor(
        private dataService: DataService,
        private notificationService: NotificationService,
        private changeDetectorRef: ChangeDetectorRef,
    ) {}

    ngOnInit() {
        this.entityDuplicators$ = this.dataService
            .query(GetEntityDuplicatorsDocument)
            .mapSingle(data => data.entityDuplicators.filter(d => d.forEntities.includes(this.entityName)))
            .pipe(
                tap(duplicators => {
                    if (0 < duplicators.length) {
                        this.setSelectedDuplicator(duplicators[0]);
                    }
                }),
            );
    }

    setSelectedDuplicator(duplicator: EntityDuplicatorDef) {
        this.selectedDuplicator = duplicator;
        this.duplicatorInstance = configurableDefinitionToInstance(this.selectedDuplicator);
        this.formGroup.patchValue(this.duplicatorInstance);
        this.changeDetectorRef.markForCheck();
    }

    async duplicate() {
        const selectedDuplicator = this.selectedDuplicator;
        const formValue = this.formGroup.value;
        if (!selectedDuplicator || !formValue) {
            return;
        }
        const duplicatorInput = toConfigurableOperationInput(this.duplicatorInstance, formValue);

        const succeeded: string[] = [];
        const failed: Array<{ name: string; message: string }> = [];
        for (const entity of this.entities) {
            const { duplicateEntity } = await lastValueFrom(
                this.dataService.mutate(DuplicateEntityDocument, {
                    input: {
                        entityId: entity.id,
                        entityName: this.entityName,
                        duplicatorInput,
                    },
                }),
            );
            switch (duplicateEntity.__typename) {
                case 'DuplicateEntitySuccess':
                    succeeded.push(this.getEntityName(entity));
                    break;
                case 'DuplicateEntityError':
                    failed.push({
                        name: this.getEntityName(entity),
                        message: duplicateEntity.duplicationError,
                    });
                    break;
                case undefined:
                    break;
                default:
                    assertNever(duplicateEntity);
            }
        }
        if (0 < succeeded.length) {
            this.notificationService.success(_('common.notify-duplicate-success'), {
                count: succeeded.length,
                names: succeeded.join(', '),
            });
        }
        if (0 < failed.length) {
            const failedCount = failed.length;
            const maxNotices = 5;
            const excess = failedCount - maxNotices;
            for (let i = 0; i < Math.min(failedCount, maxNotices); i++) {
                const failedItem = failed[i];
                this.notificationService.error(_('common.notify-duplicate-error'), {
                    name: failedItem.name,
                    error: failedItem.message,
                });
            }
            if (excess > 0) {
                this.notificationService.error(_('common.notify-duplicate-error-excess'), { count: excess });
            }
        }
        this.resolveWith(true);
    }

    cancel() {
        this.resolveWith();
    }
}
