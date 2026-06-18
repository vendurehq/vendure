import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

const JOB_LOOKBACK_MS = 5000; // Look back 5 seconds to catch jobs created before mutation returned
const MAX_POLLING_TIMEOUT_MS = 30000;
const INITIAL_POLL_INTERVAL_MS = 500;
const MAX_POLL_INTERVAL_MS = 4000;
const STORAGE_KEY_PREFIX = 'job-queue-polling:';

interface StoredPollingState {
    startTime: string;
    expiresAt: number;
}

const jobListForPollingDocument = graphql(`
    query JobListForPolling($options: JobListOptions) {
        jobs(options: $options) {
            items {
                id
                createdAt
                state
            }
            totalItems
        }
    }
`);

const getStorageKey = (queueName: string) => `${STORAGE_KEY_PREFIX}${queueName}`;
const getStoredState = (queueName: string) => {
    try {
        const stored = sessionStorage.getItem(getStorageKey(queueName));
        if (stored) {
            return JSON.parse(stored) as StoredPollingState;
        }
    } catch {
        // Ignore parsing errors
    }
    return null;
};
const setStoredState = (queueName: string, state: StoredPollingState) =>
    sessionStorage.setItem(getStorageKey(queueName), JSON.stringify(state));
const clearStoredState = (queueName: string) => sessionStorage.removeItem(getStorageKey(queueName));

/**
 * Hook to poll a job queue until jobs complete.
 * Waits for jobs created after polling starts to settle before calling onComplete.
 *
 * Polling state is persisted in sessionStorage, allowing it to survive navigation
 * (e.g., after creating an entity) and page refresh while maintaining the correct
 * time window for finding relevant jobs.
 */
export function useJobQueuePolling(queueName: string, onComplete: () => void) {
    const [isPolling, setIsPolling] = useState(false);
    const [pollCount, setPollCount] = useState(0);
    const startTimeRef = useRef<string | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onCompleteRef = useRef(onComplete);
    const hasResumedRef = useRef(false);

    useEffect(() => {
        onCompleteRef.current = onComplete;
    }, [onComplete]);

    // On mount, check for pending polling state
    useEffect(() => {
        if (hasResumedRef.current) return;
        hasResumedRef.current = true;

        const stored = getStoredState(queueName);
        if (stored && Date.now() < stored.expiresAt) {
            startTimeRef.current = stored.startTime;
            setPollCount(0);
            setIsPolling(true);

            const remainingTime = stored.expiresAt - Date.now();
            timeoutRef.current = setTimeout(() => {
                setIsPolling(false);
                startTimeRef.current = null;
                clearStoredState(queueName);
                onCompleteRef.current();
            }, remainingTime);
        } else if (stored) {
            clearStoredState(queueName);
        }
    }, [queueName]);

    // Calculate exponential backoff interval
    const pollInterval = isPolling
        ? Math.min(INITIAL_POLL_INTERVAL_MS * Math.pow(1.75, pollCount), MAX_POLL_INTERVAL_MS)
        : false;

    const { data: jobsData } = useQuery({
        queryKey: ['jobQueuePolling', queueName],
        queryFn: () => {
            setPollCount(c => c + 1);
            return api.query(jobListForPollingDocument, {
                options: {
                    filter: { queueName: { eq: queueName } },
                    sort: { createdAt: 'DESC' as const },
                    take: 10,
                },
            });
        },
        enabled: isPolling,
        refetchInterval: pollInterval,
    });

    // Detect job completion
    useEffect(() => {
        const startTime = startTimeRef.current;
        if (!isPolling || !startTime) return;

        const relevantJobs = jobsData?.jobs.items.filter(j => j.createdAt >= startTime) ?? [];
        const hasSettledJob =
            relevantJobs.length > 0 &&
            relevantJobs.every(j => j.state !== 'PENDING' && j.state !== 'RUNNING' && j.state !== 'RETRYING');

        if (hasSettledJob) {
            setIsPolling(false);
            startTimeRef.current = null;
            clearStoredState(queueName);
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
            onCompleteRef.current();
        }
    }, [jobsData, isPolling, queueName]);

    useEffect(() => {
        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    const startPolling = useCallback(() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        const startTime = new Date(Date.now() - JOB_LOOKBACK_MS).toISOString();
        const expiresAt = Date.now() + MAX_POLLING_TIMEOUT_MS;

        // Store in sessionStorage so polling can resume after navigation
        setStoredState(queueName, { startTime, expiresAt });

        startTimeRef.current = startTime;
        setPollCount(0);
        setIsPolling(true);

        timeoutRef.current = setTimeout(() => {
            setIsPolling(false);
            startTimeRef.current = null;
            clearStoredState(queueName);
            onCompleteRef.current();
        }, MAX_POLLING_TIMEOUT_MS);
    }, [queueName]);

    return { isPolling, startPolling };
}
