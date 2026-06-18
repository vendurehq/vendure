import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
    BaseListComponent,
    DataService,
    GetAllJobsQuery,
    GetJobQueueListQuery,
    ItemOf,
    JobState,
    SortOrder,
} from '@vendure/admin-ui/core';
import { Observable, timer } from 'rxjs';
import { filter, map, takeUntil } from 'rxjs/operators';

@Component({
    selector: 'vdr-job-list',
    templateUrl: './job-list.component.html',
    styleUrls: ['./job-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class JobListComponent
    extends BaseListComponent<GetAllJobsQuery, ItemOf<GetAllJobsQuery, 'jobs'>>
    implements OnInit
{
    queues$: Observable<GetJobQueueListQuery['jobQueues']>;
    liveUpdate = new FormControl(true);
    queueFilter = new FormControl('all');
    stateFilter = new FormControl<JobState | string>('');

    constructor(private dataService: DataService, router: Router, route: ActivatedRoute) {
        super(router, route);
        super.setQueryFn(
            (...args: any[]) => this.dataService.settings.getAllJobs(...args),
            data => data.jobs,
            (skip, take) => {
                const queueFilter =
                    this.queueFilter.value === 'all' ? null : { queueName: { eq: this.queueFilter.value } };
                const stateFilter = this.stateFilter.value;
                return {
                    options: {
                        skip,
                        take,
                        filter: {
                            ...queueFilter,
                            ...(stateFilter ? { state: { eq: stateFilter } } : {}),
                        },
                        sort: {
                            createdAt: SortOrder.DESC,
                        },
                    },
                };
            },
        );
    }

    ngOnInit(): void {
        super.ngOnInit();
        timer(5000, 2000)
            .pipe(
                takeUntil(this.destroy$),
                filter(() => !!this.liveUpdate.value),
            )
            .subscribe(() => {
                this.refresh();
            });
        this.queues$ = this.dataService.settings
            .getJobQueues()
            .mapStream(res => res.jobQueues)
            .pipe(map(queues => [{ name: 'all', running: true }, ...queues]));
    }

    hasResult(job: ItemOf<GetAllJobsQuery, 'jobs'>): boolean {
        const result = job.result;
        if (result == null) {
            return false;
        }
        if (typeof result === 'object') {
            return Object.keys(result).length > 0;
        }
        return true;
    }

    cancelJob(id: string) {
        this.dataService.settings.cancelJob(id).subscribe(() => this.refresh());
    }
}
