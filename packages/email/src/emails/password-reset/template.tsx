import { EmailButton, EmailLayout, EmailMutedText, EmailSection, EmailText, EmailTitle } from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import { urlWithToken } from '../../components/formatting';
import { useEmailContent } from '../../template/email-content';
import { defineEmailTemplate } from '../../template/email-template';

export interface PasswordResetProps {
    /** Global template variable: the storefront password reset page. */
    passwordResetUrl?: string;
    passwordResetToken: string;
    branding?: EmailBranding;
}

export const PasswordResetTemplate = defineEmailTemplate<PasswordResetProps>({
    content: {
        subject: { label: 'Subject', default: 'Reset your password' },
        preview: { label: 'Inbox preview text', default: 'Choose a new password for your account' },
        title: { label: 'Title', default: 'Reset your password' },
        intro: {
            label: 'Introduction',
            default: 'We received a request to reset the password of your account. Choose a new one below.',
            multiline: true,
        },
        buttonLabel: { label: 'Button label', default: 'Choose a new password' },
        note: {
            label: 'Note',
            default: 'If you did not ask for this, you can ignore this email. Your password has not been changed.',
            multiline: true,
        },
    },
    body: ({ passwordResetUrl, passwordResetToken, branding }) => {
        const content = useEmailContent();
        return (
            <EmailLayout title={content.title} preview={content.preview} branding={branding}>
                <EmailSection>
                    <EmailTitle>{content.title}</EmailTitle>
                    <EmailText>{content.intro}</EmailText>
                    <EmailButton href={urlWithToken(passwordResetUrl, passwordResetToken)} fallbackLink>
                        {content.buttonLabel}
                    </EmailButton>
                    <EmailMutedText>{content.note}</EmailMutedText>
                </EmailSection>
            </EmailLayout>
        );
    },
});
