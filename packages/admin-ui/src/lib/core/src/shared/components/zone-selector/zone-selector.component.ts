import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    EventEmitter,
    Input,
    Output,
    ViewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { NgSelectComponent } from '@ng-select/ng-select';
import { gql } from 'apollo-angular';
import { Subject } from 'rxjs';
import { ItemOf } from '../../../common/base-list.component';
import { GetZoneSelectorListDocument, GetZoneSelectorListQuery } from '../../../common/generated-types';
import { DataService } from '../../../data/providers/data.service';

export const GET_ZONE_SELECTOR_LIST = gql`
    query GetZoneSelectorList($options: ZoneListOptions) {
        zones(options: $options) {
            items {
                id
                createdAt
                updatedAt
                name
            }
            totalItems
        }
    }
`;

type Zone = ItemOf<GetZoneSelectorListQuery, 'zones'>;

/**
 * @description
 * A form control for selecting zones.
 *
 * @docsCategory components
 */
@Component({
    selector: 'vdr-zone-selector',
    templateUrl: './zone-selector.component.html',
    styleUrls: ['./zone-selector.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: ZoneSelectorComponent,
            multi: true,
        },
    ],
    standalone: false,
})
export class ZoneSelectorComponent implements ControlValueAccessor {
    @Output() selectedValuesChange = new EventEmitter<Zone>();
    @Input() readonly = false;
    @Input() transformControlValueAccessorValue: (value: Zone | undefined) => any = value => value?.id;
    selectedId$ = new Subject<string>();

    @ViewChild(NgSelectComponent) private ngSelect: NgSelectComponent;

    onChangeFn: (val: any) => void;
    onTouchFn: () => void;
    disabled = false;
    value: string | Zone;
    zones$ = this.dataService
        .query(GetZoneSelectorListDocument, { options: { take: 999 } })
        .mapSingle(result => result.zones.items);

    constructor(
        private dataService: DataService,
        private changeDetectorRef: ChangeDetectorRef,
    ) {}

    onChange(selected: Zone) {
        if (this.readonly) {
            return;
        }
        this.selectedValuesChange.emit(selected);
        if (this.onChangeFn) {
            const transformedValue = this.transformControlValueAccessorValue(selected);
            this.onChangeFn(transformedValue);
        }
    }

    registerOnChange(fn: any) {
        this.onChangeFn = fn;
    }

    registerOnTouched(fn: any) {
        this.onTouchFn = fn;
    }

    setDisabledState(isDisabled: boolean): void {
        this.disabled = isDisabled;
    }

    focus() {
        this.ngSelect.focus();
    }

    writeValue(obj: string | Zone | null): void {
        if (typeof obj === 'string' && obj.length > 0) {
            this.value = obj;
        }
    }
}
