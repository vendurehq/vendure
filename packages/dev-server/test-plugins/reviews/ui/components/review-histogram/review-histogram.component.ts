import { ChangeDetectionStrategy, Component, Input, OnChanges, Output, EventEmitter } from '@angular/core';
import { SharedModule } from '@vendure/admin-ui/core';

import { ProductReviewHistogramItem } from '../../generated-types';
import { StarRatingComponent } from '../star-rating/star-rating.component';

@Component({
    selector: 'review-histogram',
    templateUrl: './review-histogram.component.html',
    styleUrls: ['./review-histogram.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [SharedModule, StarRatingComponent],
})
export class ReviewHistogramComponent implements OnChanges {
    @Input() binData: ProductReviewHistogramItem[] | null = [];
    @Output() filterChange = new EventEmitter<number | null>();
    bins = [5, 4, 3, 2, 1];
    filteredBin: number | null = null;
    private max: number;

    ngOnChanges() {
        this.max = this.binData ? Math.max(...this.binData.map(d => d.frequency)) : 0;
    }

    getPercentage(bin: number): number {
        if (!this.binData) {
            return 0;
        }
        const data = this.binData.find(d => d.bin === bin);
        if (!data) {
            return 0;
        }
        return Math.round((data.frequency / this.max) * 100);
    }

    getFrequency(bin: number): number {
        if (!this.binData) {
            return 0;
        }
        const data = this.binData.find(d => d.bin === bin);
        if (!data) {
            return 0;
        }
        return data.frequency;
    }

    toggleBinFilter(bin: number) {
        if (this.filteredBin === bin) {
            this.filteredBin = null;
        } else {
            this.filteredBin = bin;
        }
        this.filterChange.emit(this.filteredBin);
    }
}
