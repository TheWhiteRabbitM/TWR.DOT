# The Button

One global button. Every human may press it exactly once, ever.

Presses are keyed on the caller's personhood **`contextAlias`**, not on `msg.sender`.
Anyone can generate unlimited addresses, so an address-keyed counter would be a bot
leaderboard within minutes. One human resolves to exactly one alias within this
contract's context, and that alias is a per-application pseudonym — it cannot be linked
to the same human's activity in any other application.

Reinstalling the app changes nothing: the alias is derived from the account key, never
stored on the device.

## Interface

- `press()` — records the caller and returns their 1-based ordinal. Reverts with
  `NotHuman` below the required personhood tier, or `AlreadyPressed` if this human
  already pressed.
- `snapshot(address)` — everything a frontend needs in one call: global total, the
  account's ordinal, its personhood tier, and its alias.
- `roll(offset, limit)` — paginated press history.
- `ordinalOf(bytes32)` / `rollLength()` / `totalPresses()`.

## Deployment note

`minStatus` must be **2 (Full)**. Tier 1 (Lite) only means "registered a username",
which any number of fresh accounts can do — deploying with 1 lets one human press
repeatedly and defeats the entire premise.
