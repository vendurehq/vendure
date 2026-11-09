import { JobState } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import { Job } from '../../../job-queue/job';

import { JobEntityResolver } from './job-entity.resolver';

// The Job `data`, `result` and `error` fields must not return credentials.
describe('JobEntityResolver', () => {
    const resolver = new JobEntityResolver();

    function serializedCtx() {
        return {
            _apiType: 'shop',
            _languageCode: 'en',
            _isAuthorized: false,
            _authorizedAsOwnerOnly: false,
            _channel: {
                id: 1,
                code: '__default_channel__',
                token: 'channel-token',
                customFields: { internalNotes: 'channel-secret' },
                defaultTaxZone: { id: 1, name: 'Europe' },
            },
            _session: {
                id: 1,
                token: 'session-token',
                user: { id: 1, identifier: 'superadmin', channelPermissions: [] },
            },
            _req: { headers: { authorization: 'Bearer session-token' } },
        };
    }

    function sendEmailJob() {
        return new Job({
            queueName: 'send-email',
            data: {
                ctx: serializedCtx(),
                type: 'password-reset',
                recipient: 'victim@test.com',
                templateVars: {
                    passwordResetToken: 'reset-token-value',
                    resetUrl: 'https://shop.test/reset?token=reset-token-value',
                    order: { code: 'ABC', customer: { emailAddress: 'victim@test.com' } },
                },
                attachments: [
                    {
                        filename: 'invoice.pdf',
                        contentType: 'application/pdf',
                        content: '"attachment-body"',
                        path: 'https://bucket.test/invoice.pdf?X-Amz-Signature=presigned',
                    },
                ],
            },
        });
    }

    describe('data', () => {
        it('replaces every templateVars value and keeps the keys', async () => {
            const data = await resolver.data(sendEmailJob());

            expect(data.templateVars).toEqual({
                passwordResetToken: '[redacted]',
                resetUrl: '[redacted]',
                order: '[redacted]',
            });
        });

        it('redacts templateVars whatever the queue name', async () => {
            const job = new Job({
                queueName: 'custom-mailer',
                data: { templateVars: { verificationToken: 'verify-token-value' } },
            });

            const data = await resolver.data(job);

            expect(data.templateVars).toEqual({ verificationToken: '[redacted]' });
        });

        it('redacts a templateVars object and its attachments at any depth', async () => {
            const job = new Job({
                queueName: 'custom-mailer',
                data: {
                    email: {
                        templateVars: { resetUrl: 'https://shop.test/reset?token=nested-token' },
                        attachments: [{ filename: 'a.txt', path: 'https://bucket.test/nested-presigned' }],
                    },
                },
            });

            const data = await resolver.data(job);

            expect(data.email).toEqual({
                templateVars: { resetUrl: '[redacted]' },
                attachments: [{ filename: 'a.txt' }],
            });
        });

        it('removes attachment content and path and keeps filename and contentType', async () => {
            const data = await resolver.data(sendEmailJob());

            expect(data.attachments).toEqual([{ filename: 'invoice.pdf', contentType: 'application/pdf' }]);
        });

        it('prunes ctx._channel to id, code and token', async () => {
            const data = await resolver.data(sendEmailJob());

            expect(data.ctx._channel).toEqual({ id: 1, code: '__default_channel__', token: 'channel-token' });
            expect(data.ctx._session.token).toBeUndefined();
            expect(data.ctx._req).toBeUndefined();
        });

        it('returns no secret value anywhere in the output', async () => {
            const data = await resolver.data(sendEmailJob());
            const serialized = JSON.stringify(data);

            for (const secret of [
                'reset-token-value',
                'session-token',
                'channel-secret',
                'attachment-body',
                'presigned',
            ]) {
                expect(serialized).not.toContain(secret);
            }
        });

        it('redacts deny-listed keys at any depth, case-insensitively', async () => {
            const job = new Job({
                queueName: 'custom-queue',
                data: {
                    user: {
                        identifier: 'victim@test.com',
                        authenticationMethods: [{ id: 1, passwordHash: 'hash-value' }],
                    },
                    PASSWORD: 'plain-password',
                    request: { headers: { Authorization: 'Bearer abc', Cookie: 'session=abc' } },
                    nested: { a: { b: { identifierChangeToken: 'change-token-value' } } },
                },
            });

            const data = await resolver.data(job);

            expect(data.user.identifier).toBe('victim@test.com');
            expect(data.user.authenticationMethods[0]).toEqual({ id: 1, passwordHash: '[redacted]' });
            expect(data.PASSWORD).toBe('[redacted]');
            expect(data.request.headers).toEqual({ Authorization: '[redacted]', Cookie: '[redacted]' });
            expect(data.nested.a.b.identifierChangeToken).toBe('[redacted]');
        });

        it('matches deny-listed keys exactly, not as substrings', async () => {
            const job = new Job({
                queueName: 'custom-queue',
                data: { tokenCount: 3, passwordResetTokenExpiry: 'later', channelToken: 'abc' },
            });

            const data = await resolver.data(job);

            expect(data).toEqual({ tokenCount: 3, passwordResetTokenExpiry: 'later', channelToken: 'abc' });
        });

        it('redacts deny-listed keys inside a ctx that is not a serialized RequestContext', async () => {
            const job = new Job({
                queueName: 'custom-queue',
                data: { ctx: { passwordResetToken: 'reset-token-value' } },
            });

            const data = await resolver.data(job);

            expect(data.ctx.passwordResetToken).toBe('[redacted]');
        });

        it('strips the session token and raw request from a serialized context under any key', async () => {
            const job = new Job({
                queueName: 'custom-queue',
                data: { payload: { requestContext: serializedCtx() } },
            });

            const data = await resolver.data(job);

            expect(data.payload.requestContext._session.token).toBeUndefined();
            expect(data.payload.requestContext._session.user.identifier).toBe('superadmin');
            expect(data.payload.requestContext._req).toBeUndefined();
            expect(JSON.stringify(data)).not.toContain('session-token');
        });

        it('redacts common credential key names', async () => {
            const job = new Job({
                queueName: 'custom-queue',
                data: {
                    accessToken: 'a',
                    refreshToken: 'b',
                    apiKey: 'c',
                    secret: 'd',
                    clientSecret: 'e',
                    newPassword: 'f',
                    currentPassword: 'g',
                },
            });

            const data = await resolver.data(job);

            expect(Object.values(data)).toEqual(Array(7).fill('[redacted]'));
        });

        it('does not mutate job.data', async () => {
            const job = sendEmailJob();
            const before = JSON.parse(JSON.stringify(job.data));

            await resolver.data(job);

            expect(job.data).toEqual(before);
        });

        it('handles missing, primitive and array data', async () => {
            expect(await resolver.data(new Job({ queueName: 'q', data: undefined as any }))).toBeUndefined();
            expect(await resolver.data(new Job({ queueName: 'q', data: 'text' as any }))).toBe('text');
            expect(
                await resolver.data(new Job({ queueName: 'q', data: [{ password: 'x' }, 1] as any })),
            ).toEqual([{ password: '[redacted]' }, 1]);
        });
    });

    describe('result and error', () => {
        // `result` is stored as given, unlike `data`, which the Job constructor caps at depth 10.
        it('replaces values below the depth cap instead of returning them', async () => {
            let deep: any = { value: 'deep-secret' };
            for (let i = 0; i < 20; i++) {
                deep = { child: deep };
            }
            const job = new Job({ queueName: 'q', data: {} });
            job.complete(deep);

            const result = await resolver.result(job);

            // The objects at depth 0 to 10 are kept, the one at depth 11 is replaced.
            let expected: any = '[redacted]';
            for (let i = 0; i <= 10; i++) {
                expected = { child: expected };
            }
            expect(result).toEqual(expected);
            expect(JSON.stringify(result)).not.toContain('deep-secret');
        });

        it('redacts deny-listed keys in result', async () => {
            const job = new Job({ queueName: 'q', data: {} });
            job.complete({ user: { passwordHash: 'hash-value' }, count: 1 });

            const result = await resolver.result(job);

            expect(result).toEqual({ user: { passwordHash: '[redacted]' }, count: 1 });
            expect(job.result.user.passwordHash).toBe('hash-value');
        });

        it('redacts deny-listed keys in error', async () => {
            const job = new Job({ queueName: 'q', data: {}, error: { verificationToken: 'verify-token' } });

            const error = await resolver.error(job);

            expect(error).toEqual({ verificationToken: '[redacted]' });
        });

        it('converts values with toJSON() before redacting them', async () => {
            const createdAt = new Date('2026-01-01T00:00:00.000Z');
            const entity = { toJSON: () => ({ id: 1, passwordHash: 'hash-value' }) };
            const job = new Job({ queueName: 'q', data: {} });
            job.complete({ createdAt, buffer: Buffer.from('ab'), user: entity });

            const result = await resolver.result(job);

            expect(result).toEqual({
                createdAt: '2026-01-01T00:00:00.000Z',
                buffer: { type: 'Buffer', data: [97, 98] },
                user: { id: 1, passwordHash: '[redacted]' },
            });
        });

        it('replaces circular references and keeps shared ones', async () => {
            const shared = { password: 'shared-password', name: 'shared' };
            const circular: Record<string, unknown> = { name: 'root', a: shared, b: shared };
            circular.self = circular;
            const job = new Job({ queueName: 'q', data: {} });
            job.complete(circular);

            const result = await resolver.result(job);

            expect(result).toEqual({
                name: 'root',
                a: { password: '[redacted]', name: 'shared' },
                b: { password: '[redacted]', name: 'shared' },
                self: '[redacted]',
            });
        });

        it('returns primitive result and error values unchanged', async () => {
            const job = new Job({ queueName: 'q', data: {}, result: 'done', error: 'failed' });

            expect(await resolver.result(job)).toBe('done');
            expect(await resolver.error(job)).toBe('failed');
        });
    });

    describe('serialized RequestContext pruning', () => {
        function createJobWithLegacyContext() {
            return new Job({
                queueName: 'test',
                state: JobState.COMPLETED,
                data: {
                    ctx: {
                        _apiType: 'admin',
                        _channel: { id: 1, code: '__default_channel__' },
                        _languageCode: 'en',
                        _isAuthorized: true,
                        _authorizedAsOwnerOnly: false,
                        _session: {
                            id: 1,
                            token: 'legacy-session-token',
                            user: { id: 1, identifier: 'superadmin', channelPermissions: [] },
                        },
                        _req: { headers: { authorization: 'Bearer legacy-session-token' } },
                    },
                },
            });
        }

        // Job data written before GHSA-32jm-mf7r-7qw5 was fixed still holds a token and the
        // raw request, so the resolver prunes both rather than trusting the stored data.
        it('strips the session token and the raw request from a legacy context', async () => {
            const result: any = await resolver.data(createJobWithLegacyContext());

            expect(result.ctx._session.token).toBeUndefined();
            expect(result.ctx._req).toBeUndefined();
            expect(JSON.stringify(result)).not.toContain('legacy-session-token');
        });

        // A JobQueueStrategy may hand out the live Job objects, so pruning must not mutate
        // the job, or a job which has not been processed yet loses its context.
        it('does not mutate the job data', async () => {
            const job = createJobWithLegacyContext();

            await resolver.data(job);

            expect(job.data.ctx._session.token).toBe('legacy-session-token');
            expect(job.data.ctx._req).toBeDefined();
        });

        it('returns the data untouched when it holds no serialized context', async () => {
            const job = new Job({ queueName: 'test', state: JobState.COMPLETED, data: { foo: 'bar' } });

            expect(await resolver.data(job)).toEqual({ foo: 'bar' });
        });

        it('tolerates job data being null', async () => {
            const job = new Job({ queueName: 'test', state: JobState.COMPLETED, data: null as any });

            expect(await resolver.data(job)).toBeNull();
        });
    });
});
