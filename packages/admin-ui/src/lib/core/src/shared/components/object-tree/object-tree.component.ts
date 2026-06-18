import {
    ChangeDetectionStrategy,
    Component,
    Input,
    OnChanges,
    OnInit,
    Optional,
    SkipSelf,
} from '@angular/core';

/**
 * @description
 * This component displays a plain JavaScript object as an expandable tree.
 *
 * @example
 * ```HTML
 * <vdr-object-tree [value]="payment.metadata"></vdr-object-tree>
 * ```
 *
 * @docsCategory components
 */
@Component({
    selector: 'vdr-object-tree',
    templateUrl: './object-tree.component.html',
    styleUrls: ['./object-tree.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class ObjectTreeComponent implements OnChanges {
    @Input() value: { [key: string]: any } | string;
    @Input() isArrayItem = false;
    depth: number;
    expanded: boolean;
    valueIsArray: boolean;
    entries: Array<{ key: string; value: any }>;
    constructor(@Optional() @SkipSelf() parent: ObjectTreeComponent) {
        if (parent) {
            this.depth = parent.depth + 1;
        } else {
            this.depth = 0;
        }
    }

    ngOnChanges() {
        this.entries = this.getEntries(this.value);
        this.expanded = this.depth === 0 || this.isArrayItem;
        this.valueIsArray = Object.keys(this.value).every(v => Number.isInteger(+v));
    }

    isObject(value: any): boolean {
        return typeof value === 'object' && value !== null;
    }

    private getEntries(inputValue: { [key: string]: any } | string): Array<{ key: string; value: any }> {
        if (!this.isObject(inputValue)) {
            return [{ key: '', value: inputValue }];
        }
        return Object.entries(inputValue).map(([key, value]) => ({ key, value }));
    }
}
