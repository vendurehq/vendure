import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { JobInfoFragment, JobState } from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-job-state-label',
    templateUrl: './job-state-label.component.html',
    styleUrls: ['./job-state-label.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class JobStateLabelComponent {
    @Input()
    job: JobInfoFragment;

    get iconShape(): string {
        switch (this.job.state) {
            case JobState.COMPLETED:
                return 'check-circle';
            case JobState.FAILED:
                return 'exclamation-circle';
            case JobState.CANCELLED:
                return 'ban';
            case JobState.PENDING:
            case JobState.RETRYING:
                return 'hourglass';
            case JobState.RUNNING:
                return 'sync';
        }
    }

    get colorType(): string {
        switch (this.job.state) {
            case JobState.COMPLETED:
                return 'success';
            case JobState.FAILED:
            case JobState.CANCELLED:
                return 'error';
            case JobState.PENDING:
            case JobState.RETRYING:
                return '';
            case JobState.RUNNING:
                return 'warning';
        }
    }
}
