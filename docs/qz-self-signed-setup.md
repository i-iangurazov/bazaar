# QZ Tray self-signed trusted printing setup

Bazaar can use QZ Tray without a paid QZ certificate by using a self-signed Bazaar certificate. Signing alone is not enough: Bazaar must sign every QZ request, and every cashier terminal must configure QZ Tray to trust the same Bazaar certificate locally.

## 1. Generate the Bazaar certificate and private key

Run this once for the Bazaar deployment:

```bash
openssl req -x509 -newkey rsa:2048 -sha512 -nodes \
  -keyout qz-private-key.pem \
  -out bazaar-qz-certificate.txt \
  -days 3650 \
  -subj "/C=KG/O=Bazaar/CN=Bazaar POS Printing"
```

Do not commit `qz-private-key.pem`. Treat it as a production secret.

## 2. Configure Bazaar server env

Use either raw PEM text:

```env
QZ_CERTIFICATE="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
QZ_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

or base64:

```bash
base64 -i bazaar-qz-certificate.txt
base64 -i qz-private-key.pem
```

```env
QZ_CERTIFICATE_BASE64="..."
QZ_PRIVATE_KEY_BASE64="..."
```

or server-only paths:

```env
QZ_CERTIFICATE_PATH="/secure/path/bazaar-qz-certificate.txt"
QZ_PRIVATE_KEY_PATH="/secure/path/qz-private-key.pem"
```

Restart Bazaar after changing these values.

## 3. Download the exact certificate from Bazaar

Open `/settings/printing` and click `Скачать сертификат Bazaar для QZ`.

This downloads the exact certificate returned by `GET /api/qz/certificate`. Use this file for all cashier terminals.

## 4. Provision each QZ Tray client

Install QZ Tray on the cashier computer. Then whitelist the Bazaar certificate.

macOS:

```bash
"/Applications/QZ Tray.app/Contents/MacOS/QZ Tray" --whitelist "/path/to/bazaar-qz-certificate.txt"
```

Windows:

```bat
"%PROGRAMFILES%\QZ Tray\qz-tray-console.exe" --whitelist "C:\path\to\bazaar-qz-certificate.txt"
```

Linux:

```bash
/opt/qz-tray/qz-tray --whitelist "/path/to/bazaar-qz-certificate.txt"
```

The `--whitelist` flag may also be available as `--allow` or `-a`, depending on QZ Tray version.

## 5. authcert.override option

For installations that manage QZ Tray configuration directly, add an absolute certificate path to QZ Tray properties:

```properties
authcert.override=/absolute/path/to/bazaar-qz-certificate.txt
```

On Windows, escape backslashes:

```properties
authcert.override=C:\\Program Files\\QZ Tray\\bazaar-qz-certificate.txt
```

Some QZ Tray versions also support placing the certificate as `override.crt` in the QZ Tray application directory. Prefer the `--whitelist` command for cashier terminals unless deployment packaging deliberately manages `qz-tray.properties`.

## 6. Restart QZ Tray

Quit QZ Tray completely and start it again. The trust state is not reliable until QZ Tray has restarted after provisioning.

## 7. Verify fingerprints

In Bazaar `/settings/printing`, compare the shown `SHA-256 fingerprint` with QZ Tray request details.

Expected after full setup:

- `Signature`: present
- `Validity`: valid
- `Organization`: Bazaar
- `Common Name`: Bazaar POS Printing
- `Trusted`: trusted
- `Fingerprint`: matches Bazaar settings page

If QZ still shows `Trusted: Untrusted website`, signing is working but the terminal has not trusted the certificate. Re-run the local provisioning step with the exact certificate downloaded from Bazaar and restart QZ Tray.

If QZ shows `Signature: Missing`, Bazaar is not using `QZ_PRIVATE_KEY`.

If QZ shows an anonymous certificate, Bazaar is not using `QZ_CERTIFICATE`.

If QZ shows invalid validity, the certificate and private key do not match or the terminal trusts a different certificate.
