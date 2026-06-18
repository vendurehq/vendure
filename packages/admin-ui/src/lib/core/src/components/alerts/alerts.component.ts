import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ActiveAlert, AlertsService } from '../../providers/alerts/alerts.service';

@Component({
    selector: 'vdr-alerts',
    templateUrl: './alerts.component.html',
    styleUrls: ['./alerts.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class AlertsComponent {
    protected hasAlerts$: Observable<boolean>;
    protected activeAlerts$: Observable<ActiveAlert[]>;
    constructor(protected alertsService: AlertsService) {
        this.hasAlerts$ = alertsService.activeAlerts$.pipe(
            map(alerts => alerts.filter(a => !a.hasRun).length > 0),
        );
        this.activeAlerts$ = alertsService.activeAlerts$;
    }
}
