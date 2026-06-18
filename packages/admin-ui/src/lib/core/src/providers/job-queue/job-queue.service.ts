import { Injectable, OnDestroy } from '@angular/core';
import { EMPTY, interval, Observable, of, Subject, Subscription, timer } from 'rxjs';
import { debounceTime, map, mapTo, scan, shareReplay, switchMap } from 'rxjs/operators';

import { JobInfoFragment, JobState, Permission } from '../../common/generated-types';
import { DataService } from '../../data/providers/data.service';

@Injectable({
    providedIn: 'root',
})
export class JobQueueService implements OnDestroy {
    activeJobs$: Observable<JobInfoFragment[]>;

    private updateJob$ = new Subject<JobInfoFragment>();
    private onCompleteHandlers = new Map<string, (job: JobInfoFragment) => void>();
    private readonly subscription: Subscription;

    constructor(private dataService: DataService) {
        this.checkForJobs();

        this.activeJobs$ = this.updateJob$.pipe(
            scan<JobInfoFragment, Map<string, JobInfoFragment>>(
                (jobMap, job) => this.handleJob(jobMap, job),
                new Map<string, JobInfoFragment>(),
            ),
            map(jobMap => Array.from(jobMap.values())),
            debounceTime(500),
            shareReplay(1),
        );

        this.subscription = this.activeJobs$
            .pipe(
                switchMap(jobs => {
                    if (jobs.length) {
                        return interval(2500).pipe(mapTo(jobs));
                    } else {
                        return of([]);
                    }
                }),
            )
            .subscribe(jobs => {
                if (jobs.length) {
                    this.dataService.settings.pollJobs(jobs.map(j => j.id)).single$.subscribe(data => {
                        data.jobsById.forEach(job => {
                            this.updateJob$.next(job);
                        });
                    });
                }
            });
    }

    ngOnDestroy(): void {
        if (this.subscription) {
            this.subscription.unsubscribe();
        }
    }

    /**
     * After a given delay, checks the server for any active jobs.
     */
    checkForJobs(delay = 1000) {
        timer(delay)
            .pipe(
                switchMap(() => this.dataService.client.userStatus().mapSingle(data => data.userStatus)),
                switchMap(userStatus => {
                    if (userStatus.permissions.includes(Permission.ReadSettings) && userStatus.isLoggedIn) {
                        return this.dataService.settings.getRunningJobs().single$;
                    } else {
                        return EMPTY;
                    }
                }),
            )
            .subscribe(data => data.jobs.items.forEach(job => this.updateJob$.next(job)));
    }

    addJob(jobId: string, onComplete?: (job: JobInfoFragment) => void) {
        this.dataService.settings.getJob(jobId).single$.subscribe(({ job }) => {
            if (job) {
                this.updateJob$.next(job);
                if (onComplete) {
                    this.onCompleteHandlers.set(jobId, onComplete);
                }
            }
        });
    }

    private handleJob(jobMap: Map<string, JobInfoFragment>, job: JobInfoFragment) {
        switch (job.state) {
            case JobState.RUNNING:
            case JobState.PENDING:
                jobMap.set(job.id, job);
                break;
            case JobState.COMPLETED:
            case JobState.FAILED:
            case JobState.CANCELLED:
                jobMap.delete(job.id);
                const handler = this.onCompleteHandlers.get(job.id);
                if (handler) {
                    handler(job);
                    this.onCompleteHandlers.delete(job.id);
                }
                break;
        }
        return jobMap;
    }
}
