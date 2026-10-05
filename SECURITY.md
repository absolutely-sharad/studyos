# Security Policy

StudyOS stores students' study materials and progress. We take reports seriously.

## Reporting a vulnerability

Please report vulnerabilities privately to the address configured in `SECURITY_CONTACT_EMAIL` for this deployment. Do not open a public issue.

Include:

- A description of the issue and its impact
- Steps to reproduce or a proof of concept
- Affected routes, versions or configuration

We aim to acknowledge reports within 3 business days and to share a fix timeline after triage. Please give us reasonable time to fix the issue before any public disclosure.

## Scope

In scope: authentication, authorization and data isolation between users, file upload and file serving, server actions and API routes.

Out of scope: denial of service through volume, issues in third-party services, and social engineering.

## Design notes

- Every query is scoped to the signed-in user; documents, plans and progress are never shared across accounts.
- Passwords are hashed with scrypt (OWASP-minimum parameters), run on a thread pool so a burst of sign-ins can't freeze the server, and capped at 128 bytes. Older bcrypt hashes still verify and are upgraded at the next sign-in. Sign-in takes the same time whether or not the email exists, and a server that is too busy answers "try again" without counting it against the account.
- Uploaded files are read on worker threads with their own time and memory limits, so a hostile or enormous file can only take down its own worker.
- Sign-in, sign-up, uploads, AI calls and account deletion are rate limited per address and per account, in the database, so limits hold across server instances. The limits apply to the Auth.js endpoint itself, not only the login form.
- Uploads are validated by extension and by file contents, stored under generated names, and served with a content type derived from the verified file kind (never the browser's claim), `nosniff`, `no-store`, and a sandboxing Content-Security-Policy for non-PDF files. Only the owner can read a file.
- Every page sends a Content-Security-Policy, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` and HSTS.
- Server errors are logged with a reference the student can quote; logs never contain passwords, tokens or file contents.
- Students can permanently delete their account, which removes their data and uploaded files.
- Dependencies are audited in CI and updated by Dependabot.
