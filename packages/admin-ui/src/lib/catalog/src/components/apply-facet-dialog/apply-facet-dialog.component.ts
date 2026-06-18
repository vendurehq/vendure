import {
    AfterViewInit,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    ViewChild,
} from '@angular/core';
import {
    Dialog,
    FacetValue,
    FacetValueSelectorComponent,
    FacetWithValuesFragment,
} from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-apply-facet-dialog',
    templateUrl: './apply-facet-dialog.component.html',
    styleUrls: ['./apply-facet-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ApplyFacetDialogComponent implements Dialog<FacetValue[]>, AfterViewInit {
    @ViewChild(FacetValueSelectorComponent) private selector: FacetValueSelectorComponent;
    resolveWith: (result?: FacetValue[]) => void;
    selectedValues: FacetValue[] = [];
    // Provided by caller
    facets: FacetWithValuesFragment[];

    constructor(private changeDetector: ChangeDetectorRef) {}

    ngAfterViewInit() {
        setTimeout(() => this.selector.focus(), 0);
    }

    selectValues() {
        this.resolveWith(this.selectedValues);
    }

    cancel() {
        this.resolveWith();
    }
}
