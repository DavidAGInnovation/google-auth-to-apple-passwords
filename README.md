# Google Authenticator to Apple Passwords Helper

Local-only CLI for decoding Google Authenticator export payloads into per-account setup keys you can re-enter in Apple Passwords.

## Important safety note

- Never commit Google Authenticator export QR images, migration URIs, decoded setup keys, or generated account exports.
- The repository `.gitignore` intentionally excludes `folder_qr/`, `accounts.csv`, and `accounts.md` for that reason.
- Treat every decoded setup key like a password and delete temporary files when you are done.

## What it does

- Decodes `otpauth-migration://offline?data=...` URIs from Google Authenticator exports
- Decodes local QR images that contain Google Authenticator export payloads
- Decodes every supported QR image in a local folder
- Extracts each account's issuer, label, Base32 secret, OTP parameters, and standard `otpauth://` URL
- Prints a migration report or JSON

## What it does not do

- It does not import anything into Apple Passwords directly
- It does not remove codes from Google Authenticator

## Usage

From the project directory:

```bash
npm test
node ./src/cli.js
```

The repository includes a synthetic `./folder_qr` with safe sample QR exports, so running the CLI with no arguments works out of the box.

With no input argument, the CLI first looks for `./folder_qr` in the current working directory. If it is not there, it falls back to the project's own `folder_qr` next to `src`.

If you want to point it somewhere else, you can still pass a specific file or folder:

```bash
node ./src/cli.js ./migration.txt
```

You can also pass the migration URI directly:

```bash
node ./src/cli.js 'otpauth-migration://offline?data=...'
```

Or via stdin:

```bash
pbpaste | node ./src/cli.js
```

Or point it at a local screenshot/photo of the export QR:

```bash
node ./src/cli.js ./google-auth-export.png
```

Or point it at a folder that contains multiple export QR images:

```bash
node ./src/cli.js ./folder_qr
```

For machine-readable output:

```bash
node ./src/cli.js ./migration.txt --json
```

To export a CSV and a Markdown checklist:

```bash
node ./src/cli.js ./folder_qr --csv ./accounts.csv --md ./accounts.md
```

## Workflow

1. On the phone with Google Authenticator, open `Transfer accounts` -> `Export accounts`.
2. Save the QR screenshots or photos into a private local folder. You can use `./folder_qr` locally if you want, but the repository copy contains only synthetic samples.
3. Run the CLI either from the project root with `node ./src/cli.js` or from `src` with `./cli.js`.
4. With no input argument, the CLI will use `folder_qr` automatically.
5. If you prefer, you can still point the CLI at a different image, folder, text file, or raw `otpauth-migration://...` URI explicitly.
6. For each entry, open the matching login in Apple Passwords and use `Set Up Verification Code` -> `Enter Setup Key`.
7. Verify the generated code works before deleting anything from Google Authenticator.

The optional CSV and Markdown exports are intended to make that manual entry process easier.

## Security

- Treat the decoded setup keys like passwords.
- Keep the migration URI and any generated output local.
- Delete temporary files when the migration is finished.
- Do not publish real QR screenshots, migration payloads, or decoded exports to GitHub.
