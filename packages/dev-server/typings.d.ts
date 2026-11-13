// This file is for any 3rd party JS libs which don't have a corresponding @types/ package.

declare module 'progress';

declare module 'google-auth-library' {
    export class OAuth2Client {
        constructor(clientId?: string);
        verifyIdToken(options: { idToken: string; audience?: string }): Promise<{ getPayload(): any }>;
    }
}
