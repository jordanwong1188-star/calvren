# Calvren — customer email templates and sender setup

## What is implemented in the backend
The application sends transactional messages from the verified `NOTIFICATION_FROM_EMAIL` domain through Resend:
- Public enquiry received: personalized greeting and next steps (after the private backup record is saved).
- Private client feedback received: acknowledgement, no implied publication.
- Paid subscription welcome, onboarding submitted, and workflow scope ready for approval.

All these transactional emails set Reply-To to `calvrenautomation@gmail.com`. Sending as an unverified `@gmail.com` address through Resend is **not** supported; verify an owned domain and configure `RESEND_API_KEY` and `NOTIFICATION_FROM_EMAIL` in Supabase Edge Function secrets. Formspree continues to send its original internal enquiry notification to the operator separately. The customer receipt is best-effort, and form submission success must not depend on Resend. Non-JavaScript Formspree fallback bypasses the private copy/Calvren customer receipt; configure a matching Formspree autoresponse if you need coverage for that case and avoid duplicates for the normal JavaScript path.

## Configure Supabase Auth templates in the dashboard (not via GitHub)
Calvren's client sign-in uses `supabase.auth.signInWithOtp({email,options:{emailRedirectTo:"https://calvren.pages.dev/client",shouldCreateUser:true}})`.
Supabase itself sends the sign-in and signup emails. **Updating this repository does not update their HTML or subjects.**

Visit **Supabase → Authentication → Email Templates**, edit:
1. **Magic Link** — subject: `Your secure Calvren sign-in link`
2. **Confirm Signup** — subject: `Welcome to Calvren — confirm your email`

Use the corresponding variant below, preserving the required `{{ .ConfirmationURL }}` placeholder verbatim in each:

### Magic Link — HTML
```html
<!doctype html>
<html lang="en">
<body style="margin:0;padding:32px 16px;background:#f4f6f0;font-family:Arial,sans-serif;color:#193d32">
  <div style="max-width:560px;margin:auto;padding:35px;background:white;border:1px solid #dfe9dd;border-radius:12px">
    <p style="font-weight:800;font-size:27px;letter-spacing:-1px;margin:0 0 32px">calvren<span style="color:#96bd75">.</span></p>
    <p style="color:#76977b;letter-spacing:2px;font-weight:bold;font-size:11px">SECURE CLIENT ACCESS</p>
    <h1 style="font-family:Georgia,serif;font-weight:normal;font-size:32px">Your private Calvren workspace.</h1>
    <p style="font-size:15px;line-height:1.8">You requested a secure sign-in link. Use the button below to access your client dashboard, billing and onboarding details.</p>
    <p><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:15px 22px;background:#193d32;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold">Sign in to Calvren →</a></p>
    <p style="font-size:13px;line-height:1.7;color:#5e7466">For your security, this link is intended for you and may expire. If you didn't request it, simply ignore this email; no action is needed.</p>
    <div style="border-top:1px solid #edf0e9;padding-top:20px;margin-top:30px;font-size:12px;color:#69816e">Calvren · Thoughtful automation.<br>Questions? Contact <a href="mailto:calvrenautomation@gmail.com" style="color:#193d32">calvrenautomation@gmail.com</a></div>
  </div>
</body>
</html>
```

### Confirm Signup — HTML
```html
<!doctype html>
<html lang="en">
<body style="margin:0;padding:32px 16px;background:#f4f6f0;font-family:Arial,sans-serif;color:#193d32">
  <div style="max-width:560px;margin:auto;padding:35px;background:white;border:1px solid #dfe9dd;border-radius:12px">
    <p style="font-weight:800;font-size:27px;letter-spacing:-1px;margin:0 0 32px">calvren<span style="color:#96bd75">.</span></p>
    <p style="color:#76977b;letter-spacing:2px;font-weight:bold;font-size:11px">WELCOME TO CALVREN</p>
    <h1 style="font-family:Georgia,serif;font-weight:normal;font-size:32px">Your next steps start here.</h1>
    <p style="font-size:15px;line-height:1.8">Thanks for creating your Calvren client account. Please confirm your email address to securely access your private workspace. From there you can review your subscription and complete onboarding.</p>
    <p><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:15px 22px;background:#193d32;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold">Confirm my email →</a></p>
    <p style="font-size:13px;line-height:1.7;color:#5e7466">If you didn't start this signup, you can ignore this email. No subscription is activated simply by requesting an account.</p>
    <div style="border-top:1px solid #edf0e9;padding-top:20px;margin-top:30px;font-size:12px;color:#69816e">Calvren · Thoughtful automation.<br>Questions? Contact <a href="mailto:calvrenautomation@gmail.com" style="color:#193d32">calvrenautomation@gmail.com</a></div>
  </div>
</body>
</html>
```

## Required production checks
1. Configure **Authentication → SMTP Settings** using a verified sending domain and trusted SMTP provider. Supabase's shared default email service is not suited for public customer operations.
2. Set Auth site URL and allowed redirect(s) to match `https://calvren.pages.dev/client` exactly, including any configured custom domain.
3. Test both new-account confirmation and returning-account magic link with an inbox you control.
4. Verify a contact-form acknowledgement reaches the submitter, and the independent Formspree operator alert reaches `calvrenautomation@gmail.com`.
5. Test paid subscription welcome and onboarding stage emails with controlled test accounts. Do not tell customers messages are guaranteed until delivery is verified.
