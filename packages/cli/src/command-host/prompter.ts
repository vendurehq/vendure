import { confirm, isCancel, password, select, text } from '@clack/prompts';
import type { ConsentNeed, InputNeed } from '@vendure/common/lib/command';

import type { Prompter } from './host.js';

/** Asks a person at a terminal with @clack/prompts. */
export function createClackPrompter(): Prompter {
    return {
        async askInput(need: InputNeed, validate) {
            const answer = need.choices?.length
                ? await select({
                      message: need.description,
                      options: need.choices.map(choice => ({ value: choice, label: choice })),
                  })
                : need.secret
                  ? await password({ message: need.description, validate })
                  : await text({ message: need.description, validate });
            return isCancel(answer) ? undefined : String(answer);
        },
        async askConsent(need: ConsentNeed) {
            if (need.preview !== undefined) {
                process.stderr.write(`${JSON.stringify(need.preview, null, 2)}\n`);
            }
            const answer = await confirm({ message: need.description });
            return answer === true;
        },
    };
}
