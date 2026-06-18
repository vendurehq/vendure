import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output } from '@angular/core';

import { FacetValueFragment } from '../../../common/generated-types';

@Component({
    selector: 'vdr-facet-value-chip',
    templateUrl: './facet-value-chip.component.html',
    styleUrls: ['./facet-value-chip.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class FacetValueChipComponent implements OnInit {
    @Input() facetValue: FacetValueFragment;
    @Input() removable = true;
    @Input() displayFacetName = true;
    @Output() remove = new EventEmitter<void>();
    formattedTitle: string;

    ngOnInit() {
        const facetCode = this.facetValue.facet?.code ? `(${this.facetValue.facet.code}) ` : '';
        this.formattedTitle = `${this.facetValue.facet.name} ${facetCode}- ${this.facetValue.name}`;
    }
}
