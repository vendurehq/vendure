import { HttpClient } from '@angular/common/http';
import { TranslateLoader } from '@ngx-translate/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export type Dictionary = {
    [key: string]: string | Dictionary;
};

/**
 * A loader for ngx-translate which extends the HttpLoader functionality by stripping out any
 * values which are empty strings. This means that during development, translation keys which have
 * been extracted but not yet defined will fall back to the raw key text rather than displaying nothing.
 *
 * Originally from https://github.com/ngx-translate/core/issues/662#issuecomment-377010232
 */
export class CustomHttpTranslationLoader implements TranslateLoader {
    constructor(
        private http: HttpClient,
        private prefix: string = '/assets/i18n/',
        private suffix: string = '.json',
    ) {}

    public getTranslation(lang: string): Observable<any> {
        return this.http
            .get(`${this.prefix}${lang}${this.suffix}`)
            .pipe(map((res: any) => this.process(res)));
    }

    private process(object: Dictionary): Dictionary {
        const newObject: Dictionary = {};

        for (const key in object) {
            if (object.hasOwnProperty(key)) {
                const value = object[key];
                if (typeof value !== 'string') {
                    newObject[key] = this.process(value);
                } else if (typeof value === 'string' && value === '') {
                    // do not copy empty strings
                } else {
                    newObject[key] = object[key];
                }
            }
        }

        return newObject;
    }
}
