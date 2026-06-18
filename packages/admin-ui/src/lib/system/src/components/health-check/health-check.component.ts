import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HealthCheckService } from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-health-check',
    templateUrl: './health-check.component.html',
    styleUrls: ['./health-check.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class HealthCheckComponent {
    constructor(public healthCheckService: HealthCheckService) {}
}
