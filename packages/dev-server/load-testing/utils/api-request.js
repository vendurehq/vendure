// @ts-check
import http from 'k6/http';
import { check, fail } from 'k6';

const AUTH_TOKEN_HEADER = 'Vendure-Auth-Token';

export class ApiRequest {
    constructor(apiUrl, fileName) {
        this.document = open('../graphql/' + fileName);
        this.apiUrl = apiUrl;
        this.authToken = undefined;
    }

    /**
     * Post the GraphQL request
     */
    post(variables = {}, authToken) {
        const res = http.post(
            this.apiUrl,
            JSON.stringify({
                query: this.document,
                variables,
            }),
            {
                timeout: 120 * 1000,
                headers: {
                    Authorization: authToken ? `Bearer ${authToken}` : '',
                    'Content-Type': 'application/json',
                },
            },
        );
        check(res, {
            'Did not error': r => r.json().errors == null && r.status === 200,
        });
        const result = res.json();
        if (result.errors) {
            fail('Errored: ' + result.errors[0].message);
        }
        if (res.headers[AUTH_TOKEN_HEADER]) {
            authToken = res.headers[AUTH_TOKEN_HEADER];
            console.log(`Setting auth token: ${authToken}`);
            this.authToken = authToken;
        }
        return res.json();
    }
}

export class ShopApiRequest extends ApiRequest {
    constructor(fileName) {
        super('http://localhost:3000/shop-api/', fileName);
    }
}

export class AdminApiRequest extends ApiRequest {
    constructor(fileName) {
        super('http://localhost:3000/admin-api/', fileName);
    }
}
