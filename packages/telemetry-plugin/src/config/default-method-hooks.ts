import { CacheService, EventBus, JobQueue, JobQueueService } from '@vendure/core';

import { registerMethodHooks } from '../service/method-hooks.service';

export const defaultMethodHooks = [
    registerMethodHooks(CacheService, {
        get: {
            pre: ({ args: [key], span }) => {
                span.setAttribute('cache.key', key);
            },
            post: ({ args: [key], result: hit, span }) => {
                span.setAttribute('cache.hit', !!hit);
                if (hit) {
                    span.addEvent('cache.hit', { key });
                } else {
                    span.addEvent('cache.miss', { key });
                }
            },
        },
        set: {
            pre: ({ args: [key], span }) => {
                span.setAttribute('cache.key', key);
            },
        },
        delete: {
            pre: ({ args: [key], span }) => {
                span.setAttribute('cache.key', key);
            },
        },
        invalidateTags: {
            pre: ({ args: [tags], span }) => {
                span.setAttribute('cache.tags', tags.join(', '));
            },
        },
    }),
    registerMethodHooks(EventBus, {
        publish: {
            pre: ({ args: [event], span }) => {
                span.setAttribute('event', event.constructor.name);
                span.setAttribute('event.timestamp', event.createdAt.toISOString());
            },
        },
    }),
    registerMethodHooks(JobQueueService, {
        createQueue: {
            pre: ({ args: [options], span }) => {
                span.setAttribute('job-queue.name', options.name);
            },
        },
    }),
    registerMethodHooks(JobQueue, {
        start: {
            pre: ({ instance, span }) => {
                span.setAttribute('job-queue.name', instance.name);
            },
        },
        add: {
            pre: ({ args: [data, options], span, instance }) => {
                span.setAttribute('job.queueName', instance.name);
                // Only the key names are recorded. Job data can hold credentials, such as the
                // password reset tokens in EmailPlugin `templateVars`,
                // which must not reach the trace backend.
                span.setAttribute(
                    'job.data',
                    JSON.stringify(data && typeof data === 'object' ? Object.keys(data) : []),
                );
                span.setAttribute('job.retries', options?.retries ?? 0);
            },
            post({ result, span }) {
                span.setAttribute('job.buffered', result.id === 'buffered');
            },
        },
    }),
];
