# dot-drive

Big files, sealed, sent to a person. The bytes go to Bulletin storage, the key
goes inside a sealed dotmail letter, and neither half is worth anything alone.

Splitting them is the design. Storage sees ciphertext with no recipient attached;
the chain sees a letter with no file in it. Someone who takes one half learns
nothing, and there is no server holding both.

| Contract | Address |
|---|---|
| dotmail | `0x9e12df714fd4b581414753d07fee23e00f7e2bf3` |
| dotmail keys | `0x9d03cc0f36d123f964b09cfb154458816817b5be` |
| masks | `0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a` |
| content resolver | `0x326bdE29315199c814B1c58b431D84D16EA5cE41` |

```bash
npm install && npm run dev
npm test
```

Bulletin retention is roughly fourteen days unless renewed, so this is not
archival storage. Send the file, have them fetch it, or keep renewing it.
