import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { lastValueFrom } from 'rxjs';

/**
 * An adapter that allows the Angular HttpClient to be used as a replacement for the global `fetch` function.
 * This is used to supply a custom fetch function to the apollo-upload-client whilst also allowing the
 * use of Angular's http infrastructure such as interceptors.
 */
@Injectable()
export class FetchAdapter {
    constructor(private httpClient: HttpClient) {}

    fetch = (input: Request | string, init: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input.url;
        const method = typeof input === 'string' ? (init.method ? init.method : 'GET') : input.method;

        return lastValueFrom(
            this.httpClient.request(method, url, {
                body: init.body,
                headers: init.headers as any,
                observe: 'response',
                responseType: 'json',
                withCredentials: true,
            }),
        ).then(result => new Response(JSON.stringify(result.body), {
                status: result.status,
                statusText: result.statusText,
            }));
    };
}
