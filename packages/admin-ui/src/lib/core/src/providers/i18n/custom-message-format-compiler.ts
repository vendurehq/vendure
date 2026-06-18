/* eslint-disable no-console */
import { Injectable } from '@angular/core';
import {
    TranslateMessageFormatCompiler,
    TranslateMessageFormatDebugCompiler,
} from 'ngx-translate-messageformat-compiler';

/**
 * Work-around for Angular 9 compat.
 * See https://github.com/lephyrus/ngx-translate-messageformat-compiler/issues/53#issuecomment-583677994
 *
 * Also logs errors which would otherwise get swallowed by ngx-translate. This is important
 * because it is quite easy to make errors in messageformat syntax, and without clear
 * error messages it's very hard to debug.
 */
@Injectable({ providedIn: 'root' })
export class InjectableTranslateMessageFormatCompiler extends TranslateMessageFormatCompiler {
    compileTranslations(value: any, lang: string): any {
        try {
            return super.compileTranslations(value, lang);
        } catch (e: any) {
            console.error(`There was an error with the ${lang} translations:`);
            console.log(e);
            console.log(
                `Check the messageformat docs: https://messageformat.github.io/messageformat/page-guide`,
            );
        }
    }
}
