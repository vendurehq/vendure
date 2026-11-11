import { EmailButton, EmailLayout, EmailMutedText, EmailSection, EmailText, EmailTitle } from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import { urlWithToken } from '../../components/formatting';
import { useEmailContent } from '../../template/email-content';
import { defineEmailTemplate } from '../../template/email-template';

export interface EmailAddressChangeProps {
    /** Global template variable: the storefront page that confirms the new address. */
    changeEmailAddressUrl?: string;
    identifierChangeToken: string;
    branding?: EmailBranding;
}

export const EmailAddressChangeTemplate = defineEmailTemplate<EmailAddressChangeProps>({
    content: {
        subject: { label: 'Subject', default: 'Confirm your new email address' },
        preview: { label: 'Inbox preview text', default: 'Confirm the change of your email address' },
        title: { label: 'Title', default: 'Confirm your new email address' },
        intro: {
            label: 'Introduction',
            default: 'We received a request to change the email address of your account to this one. Confirm it to finish the change.',
            multiline: true,
        },
        buttonLabel: { label: 'Button label', default: 'Confirm email address' },
        note: {
            label: 'Note',
            default: 'If you did not ask for this, you can ignore this email.',
            multiline: true,
        },
    },
    body: ({ changeEmailAddressUrl, identifierChangeToken, branding }) => {
        const content = useEmailContent();
        return (
            <EmailLayout title={content.title} preview={content.preview} branding={branding}>
                <EmailSection>
                    <EmailTitle>{content.title}</EmailTitle>
                    <EmailText>{content.intro}</EmailText>
                    <EmailButton href={urlWithToken(changeEmailAddressUrl, identifierChangeToken)} fallbackLink>
                        {content.buttonLabel}
                    </EmailButton>
                    <EmailMutedText>{content.note}</EmailMutedText>
                </EmailSection>
            </EmailLayout>
        );
    },
});
