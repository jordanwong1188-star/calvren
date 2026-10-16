# Calvren transactional account emails

The files in this folder are polished, event-specific HTML templates for Supabase Auth. These files **do not automatically configure the hosted Supabase project**; the owner must copy each HTML file into **Supabase → Authentication → Emails → Templates**, set its subject, and save.

## Authentication emails
| Supabase option | Subject to paste | HTML file | Trigger |
| --- | --- | --- | --- |
| Confirm sign up | Welcome to Calvren — confirm your email | `confirm-signup.html` | New account created with email verification |
| Invite user | You're invited to Calvren — activate your access | `invite-user.html` | Admin explicitly invites a user |
| Magic link or OTP | Your Calvren one-time sign-in link | `magic-link.html` | Existing account requests an email sign-in link |
| Change email address | Confirm your new Calvren email address | `change-email-address.html` | Account holder requests email change |
| Reset password | Reset your Calvren password | `reset-password.html` | Password reset requested |
| Reauthentication | Your Calvren verification code | `reauthentication.html` | Supabase requires reauthentication for a sensitive operation |

## Security notifications
These messages require their individual notification switches to be enabled in Supabase. They do not automatically go out just because their templates are customized.

| Supabase option | Subject to paste | HTML file | Trigger |
| --- | --- | --- | --- |
| Password changed | Security notice: your Calvren password changed | `password-changed.html` | Password successfully changed |
| Email address changed | Security notice: your Calvren email address changed | `email-changed.html` | Email address changed |
| Phone number changed | Security notice: your Calvren phone number changed | `phone-changed.html` | Phone number changed |
| Sign-in method linked | Security notice: a Calvren sign-in method was added | `sign-in-method-linked.html` | Linked identity added |
| Sign-in method removed | Security notice: a Calvren sign-in method was removed | `sign-in-method-removed.html` | Linked identity removed |
| MFA method added | Security notice: extra Calvren verification added | `mfa-method-added.html` | MFA factor enrolled |
| MFA method removed | Security notice: Calvren verification method removed | `mfa-method-removed.html` | MFA factor unenrolled |

## Activation checklist
1. Open [Supabase Emails](https://supabase.com/dashboard/project/xjfsukhfmkgvlfpgjevg/auth/templates) and select the corresponding template.
2. Paste the table's subject into the subject field.
3. Replace the entire HTML body with its corresponding file and click **Save changes**.
4. Keep `{{ .ConfirmationURL }}` untouched for email verification, invitations, account recovery and magic links; Supabase generates a unique signed link for each email.
5. Keep `{{ .Token }}` untouched for reauthentication; the code is generated per request. The email-change template references `{{ .NewEmail }}` as supported by Supabase.
6. Enable appropriate **Security** notification toggles deliberately (especially password/email changes). Disabled features like phone, external sign-in provider, or MFA changes cannot send alerts unless the corresponding account action exists and the notification is enabled.
7. Test with an email inbox you own: a new signup confirmation, password reset and a legacy account sign-in link. Also verify whether relevant security alerts arrive after a legitimate change.
8. Check the **Authentication → Sign In / Providers → Email / Password** policy and set minimum password length to eight so Supabase accepts what the website allows. Keep email confirmation enabled.

### Boundaries
- Email+password logins do **not** automatically send a login email through Supabase's standard templates; the Magic Link email is only for magic-link/OTP flows. Avoid promising an email on each password sign-in.
- Stripe billing emails (receipts, subscription and payment-failure notices) are **not covered by Supabase**. Configure separately in Stripe Billing / customer email settings and check whether each type is enabled.
- Calvren's automation onboarding/activation emails, if desired, are separate transactional application events and require a reviewed sending workflow. Don't infer that creating a template will create those triggers.
- Keep email verification and password recovery links unique and secret. Test with a controlled account and never use real customer credentials for testing.
