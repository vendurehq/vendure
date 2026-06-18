import { ChangeDetectionStrategy, Component, Input, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { Observable, of, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, startWith, switchMap } from 'rxjs/operators';

import * as Codegen from '../../../../common/generated-types';
import { RelationCustomFieldConfig } from '../../../../common/generated-types';
import { DataService } from '../../../../data/providers/data.service';
import { ModalService } from '../../../../providers/modal/modal.service';
import { RelationSelectorDialogComponent } from '../relation-selector-dialog/relation-selector-dialog.component';

@Component({
    selector: 'vdr-relation-product-input',
    templateUrl: './relation-product-input.component.html',
    styleUrls: ['./relation-product-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class RelationProductInputComponent implements OnInit {
    @Input() readonly: boolean;
    @Input() parentFormControl: UntypedFormControl;
    @Input() config: RelationCustomFieldConfig;

    @ViewChild('selector') template: TemplateRef<any>;

    searchControl = new UntypedFormControl('');
    searchTerm$ = new Subject<string>();
    results$: Observable<Codegen.GetProductListQuery['products']['items']>;
    product$: Observable<Codegen.GetProductSimpleQuery['product'] | undefined>;

    constructor(
        private modalService: ModalService,
        private dataService: DataService,
    ) {}

    ngOnInit() {
        this.product$ = this.parentFormControl.valueChanges.pipe(
            startWith(this.parentFormControl.value),
            map(product => product?.id),
            distinctUntilChanged(),
            switchMap(id => {
                if (id) {
                    return this.dataService.product
                        .getProductSimple(id)
                        .mapStream(data => data.product || undefined);
                } else {
                    return of(undefined);
                }
            }),
        );

        this.results$ = this.searchTerm$.pipe(
            debounceTime(200),
            switchMap(term =>
                this.dataService.product
                    .getProducts({
                        ...(term
                            ? {
                                  filter: {
                                      name: {
                                          contains: term,
                                      },
                                  },
                              }
                            : {}),
                        take: 10,
                    })
                    .mapSingle(data => data.products.items),
            ),
        );
    }

    selectProduct() {
        this.modalService
            .fromComponent(RelationSelectorDialogComponent, {
                size: 'md',
                closable: true,
                locals: {
                    title: _('catalog.select-product'),
                    selectorTemplate: this.template,
                },
            })
            .subscribe(result => {
                if (result) {
                    this.parentFormControl.setValue(result);
                    this.parentFormControl.markAsDirty();
                }
            });
    }

    remove() {
        this.parentFormControl.setValue(null);
        this.parentFormControl.markAsDirty();
    }
}
