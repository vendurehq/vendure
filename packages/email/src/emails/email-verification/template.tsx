import { EmailButton, EmailLayout, EmailMutedText, EmailSection, EmailText, EmailTitle } from '../../components/blocks';
import { EmailBranding } from '../../components/branding';
import { urlWithToken } from '../../components/formatting';
import { useEmailContent } from '../../template/email-content';
import { defineEmailTemplate } from '../../template/email-template';

export interface EmailVerificationProps {
    /** Global template variable: the storefront page that verifies the address. */
    verifyEmailAddressUrl?: string;
    verificationToken: string;
    branding?: EmailBranding;
}

export const EmailVerificationTemplate = defineEmailTemplate<EmailVerificationProps>({
    content: {
        subject: { label: 'Subject', default: 'Please verify your email address' },
        preview: { label: 'Inbox preview text', default: 'Confirm your email address to finish signing up' },
        title: { label: 'Title', default: 'Verify your email address' },
        intro: {
            label: 'Introduction',
            default: 'Thanks for creating an account. Confirm this email address to finish signing up.',
            multiline: true,
        },
        buttonLabel: { label: 'Button label', default: 'Verify email address' },
        note: {
            label: 'Note',
            default: 'If you did not create an account, you can ignore this email.',
            multiline: true,
        },
    },
    body: ({ verifyEmailAddressUrl, verificationToken, branding }) => {
        const content = useEmailContent();
        return (
            <EmailLayout title={content.title} preview={content.preview} branding={branding}>
                <EmailSection>
                    <EmailTitle>{content.title}</EmailTitle>
                    <EmailText>{content.intro}</EmailText>
                    <EmailButton href={urlWithToken(verifyEmailAddressUrl, verificationToken)} fallbackLink>
                        {content.buttonLabel}
                    </EmailButton>
                    <EmailMutedText>{content.note}</EmailMutedText>
                </EmailSection>
            </EmailLayout>
        );
    },
});
