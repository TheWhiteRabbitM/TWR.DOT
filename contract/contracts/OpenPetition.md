# OpenPetition

A public petition register where one human signs once, ever, per petition.

Signatures are keyed on the signer's personhood **`contextAlias`** — a human cannot
multiply signatures with fresh addresses. Counts are stratified by tier instead of gated:
Full-tier signatures are the verified headline number; Lite-tier signatures are disclosed
separately as provisional and never merged. Accounts with no personhood are rejected.

## Interface

- `create(title, bodyCid)` — open a petition (8–160 byte title, optional Bulletin CID for
  a longer body). Capped at 5 petitions per author alias.
- `sign(id)` — sign once per human per petition. Reverts `AlreadySigned` on repeats.
- `get(id)` / `page(offset, limit)` / `count()` — read the register.
- `me(account, id)` — the caller's tier, alias, and whether they signed `id`.
