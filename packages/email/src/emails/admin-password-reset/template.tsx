import { EmailButton, EmailLayout, EmailMutedText, EmailSection, EmailText, EmailTitle } from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import { urlWithToken } from '../../components/formatting';
import { useEmailContent } from '../../template/email-content';
import { defineEmailTemplate } from '../../template/email-template';

export interface AdminPasswordResetProps {
    /** Global template variable: the Dashboard password reset page. */
    adminPasswordResetUrl?: string;
    passwordResetToken: string;
    branding?: EmailBranding;
}

export const AdminPasswordResetTemplate = defineEmailTemplate<AdminPasswordResetProps>({
    content: {
        subject: { label: 'Subject', default: 'Reset your Dashboard password' },
        preview: { label: 'Inbox preview text', default: 'Choose a new password for your administrator account' },
        title: { label: 'Title', default: 'Reset your password' },
        intro: {
            label: 'Introduction',
            default: 'We received a request to reset the password of your administrator account. Choose a new one below.',
            multiline: true,
        },
        buttonLabel: { label: 'Button label', default: 'Choose a new password' },
        note: {
            label: 'Note',
            default: 'If you did not ask for this, you can ignore this email. Your password has not been changed.',
            multiline: true,
        },
    },
    body: ({ adminPasswordResetUrl, passwordResetToken, branding }) => {
        const content = useEmailContent();
        return (
            <EmailLayout title={content.title} preview={content.preview} branding={branding}>
                <EmailSection>
                    <EmailTitle>{content.title}</EmailTitle>
                    <EmailText>{content.intro}</EmailText>
                    <EmailButton href={urlWithToken(adminPasswordResetUrl, passwordResetToken)} fallbackLink>
                        {content.buttonLabel}
                    </EmailButton>
                    <EmailMutedText>{content.note}</EmailMutedText>
                </EmailSection>
            </EmailLayout>
        );
    },
});
