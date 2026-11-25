import { confirm, isCancel, password, select, text } from '@clack/prompts';
import type {
    CommandChoice,
    CommandSelectOptions,
    CommandTextOptions,
    ConsentNeed,
    InputNeed,
} from '@vendure/common/lib/command';

/** The value of the choice that lets a person type their own. No real choice uses a NUL. */
const OTHER = '\u0000other';

import type { Prompter } from './host.js';

/** Asks a person at a terminal with @clack/prompts. */
export function createClackPrompter(): Prompter {
    return {
        async askInput(need: InputNeed, { validate, optional, boolean }) {
            if (boolean && !need.choices?.length) {
                const confirmed = await confirm({ message: need.description, initialValue: false });
                return isCancel(confirmed) ? undefined : String(confirmed);
            }
            const answer = need.choices?.length
                ? await select({
                      message: need.description,
                      options: [
                          ...need.choices.map(choice => ({ value: choice, label: choice })),
                          // An empty answer keeps the default of an optional field.
                          ...(optional ? [{ value: '', label: 'None' }] : []),
                      ],
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
        async confirm(message: string) {
            const answer = await confirm({ message, initialValue: false });
            return isCancel(answer) ? undefined : answer;
        },
        async select(message: string, choices: CommandChoice[], options: CommandSelectOptions = {}) {
            const answer = await select({
                message,
                options: [...choices, ...(options.other ? [{ value: OTHER, label: options.other }] : [])],
            });
            if (isCancel(answer)) {
                return undefined;
            }
            if (answer !== OTHER) {
                return String(answer);
            }
            const typed = await text({ message: options.other ?? message });
            return isCancel(typed) ? undefined : String(typed);
        },
        async text(message: string, options: CommandTextOptions = {}) {
            const answer = await text({
                message,
                placeholder: options.placeholder,
                initialValue: options.initialValue,
            });
            return isCancel(answer) ? undefined : String(answer);
        },
    };
}
