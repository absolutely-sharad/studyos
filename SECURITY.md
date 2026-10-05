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
- Uploaded files are served only to their owner, with `nosniff` and `no-store` headers.
- Passwords are hashed with bcrypt (cost 12).
