import { EmailTemplateSource } from '../template/email-template';

import { EmailGenerator, EmailGeneratorInput } from './email-generator';

/**
 * Simply passes through the subject and string template content without modification.
 */
export class NoopEmailGenerator implements EmailGenerator {
    canGenerate(template: EmailTemplateSource) {
        return template.kind === 'string';
    }

    generate({ from, subject, template }: EmailGeneratorInput) {
        return { from, subject, body: template.kind === 'string' ? template.body : '' };
    }
}
