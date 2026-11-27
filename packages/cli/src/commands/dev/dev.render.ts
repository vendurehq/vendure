import { showStarPromptOnce } from '../../shared/star-prompt.js';

/** Thanks a person who stopped the run, once per machine. The run printed everything else. */
export function render(output: { stopped: boolean }): void {
    if (output.stopped) {
        showStarPromptOnce();
    }
}
