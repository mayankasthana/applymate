# Security policy

## Reporting

Found a vulnerability? Please use GitHub's **"Report a vulnerability"**
(private security advisory) rather than a public issue.

## Threat model

Applymate is a **local, single-user tool**. There is no server deployment, no
accounts, and no telemetry. Its review UI:

- binds to `127.0.0.1` only,
- rejects requests whose `Host` header is not loopback (DNS-rebinding guard),
- serves files only from inside `workspace/` (path traversal returns 403),
- renders untrusted markdown escape-first, so artifacts cannot inject HTML.

Personal data (dossier, applications, chat log, preference memory) lives in
`workspace/` and `applymate.config.json`, both gitignored — it never enters
the repository.

## Out of scope

Job boards' anti-automation measures. Applymate intentionally contains no
CAPTCHA solving, fingerprint spoofing, stealth tooling, or other evasion
capabilities; the agent contract (`AGENTS.md`) explicitly forbids them.
