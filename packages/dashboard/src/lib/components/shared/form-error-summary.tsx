import { Alert, AlertDescription, AlertTitle } from '@/vdb/components/ui/alert.js';
import { Trans } from '@lingui/react/macro';
import { AlertCircle } from 'lucide-react';
import { FieldErrors, useFormState, UseFormReturn } from 'react-hook-form';

interface FlatError {
    name: string;
    // The (already-localised-or-not) message produced by the validator. When a
    // leaf error carries no message we leave this undefined and render a generic
    // translated fallback, so the summary is never empty while the form is invalid.
    message?: string;
}

/**
 * Walks the nested react-hook-form errors object and collects the leaf errors,
 * flattening nested groups like `customFields` and arrays like
 * `stockLevels.0.stockOnHand` into dotted paths. A leaf is identified by an RHF
 * error `type`; this ensures errors without a `message` are still surfaced
 * rather than silently dropped (the exact "disabled with no prompt" failure we
 * are fixing). The reserved `root` bucket (used for server/form-level errors) is
 * skipped as it is not a user-editable field.
 */
function collectErrors(errors: FieldErrors, path: string[] = []): FlatError[] {
    const result: FlatError[] = [];
    for (const [key, value] of Object.entries(errors ?? {})) {
        if (!value || key === 'root') {
            continue;
        }
        const currentPath = [...path, key];
        const message = (value as { message?: unknown }).message;
        const type = (value as { type?: unknown }).type;
        if (typeof message === 'string' && message.length > 0) {
            result.push({ name: currentPath.join('.'), message });
        } else if (typeof type === 'string') {
            result.push({ name: currentPath.join('.') });
        } else if (typeof value === 'object') {
            result.push(...collectErrors(value as FieldErrors, currentPath));
        }
    }
    return result;
}

/**
 * Turns a dotted field path into a human-readable label, e.g.
 * "customFields.myField" -> "My field", and keeps enough path context to tell
 * repeated/nested entries apart, e.g. "translations.0.name" -> "Translations #1 › Name".
 *
 * This is a best-effort fallback: the precise, configured (and translated) field
 * label is rendered next to each offending field by the form itself. Resolving
 * the configured label here would require threading the entity type / custom
 * field config into this shared component — see follow-up noted on #4741.
 */
function humanizeSegment(segment: string): string {
    const spaced = segment.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function humanizeFieldName(name: string): string {
    return name
        .split('.')
        // The "customFields" wrapper segment is noise on every custom field.
        .filter(segment => segment !== 'customFields')
        // Array indices become 1-based to disambiguate repeated groups.
        .map(segment => (/^\d+$/.test(segment) ? `#${Number(segment) + 1}` : humanizeSegment(segment)))
        .join(' › ');
}

/**
 * @description
 * Surfaces the reasons a detail-page form cannot be submitted. When the form is
 * invalid the submit button is disabled; without this summary the user has no
 * on-page indication of *why* (see issue #4741 / OSS-540), particularly when the
 * offending field is a custom field whose value fails validation and is scrolled
 * out of view.
 */
export function FormErrorSummary({ form }: Readonly<{ form: UseFormReturn<any> }>) {
    const { errors } = useFormState({ control: form.control });
    const flatErrors = collectErrors(errors);
    if (flatErrors.length === 0) {
        return null;
    }
    return (
        <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>
                <Trans>This cannot be saved until the following are fixed:</Trans>
            </AlertTitle>
            <AlertDescription>
                <ul className="list-disc pl-4">
                    {flatErrors.map(error => (
                        <li key={error.name}>
                            {/* Focusing the field scrolls it back into view — the exact
                                "offending field is scrolled out of view" case #4741 targets. */}
                            <button
                                type="button"
                                className="font-medium underline underline-offset-2 hover:no-underline"
                                onClick={() => form.setFocus(error.name)}
                            >
                                {humanizeFieldName(error.name)}
                            </button>
                            : {error.message ?? <Trans>This field is invalid</Trans>}
                        </li>
                    ))}
                </ul>
            </AlertDescription>
        </Alert>
    );
}
