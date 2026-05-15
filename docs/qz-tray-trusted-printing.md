# QZ Tray trusted printing

Bazaar POS uses QZ Tray for direct receipt and label printing. Browser print is only a fallback; production auto-print requires signed QZ requests.

For the free self-signed setup path, see `docs/qz-self-signed-setup.md`.

## Self-signed certificate path

The free deployment path is:

1. Generate a Bazaar QZ certificate and matching private key.
2. Store the private key only on the Bazaar server.
3. Configure Bazaar to serve the public certificate and sign QZ requests.
4. Provision every cashier terminal so QZ Tray trusts the Bazaar certificate.

Generate a self-signed certificate/key pair with OpenSSL:

```bash
openssl req -x509 -newkey rsa:2048 -sha512 -nodes \
  -keyout qz-private-key.pem \
  -out bazaar-qz-certificate.txt \
  -days 3650 \
  -subj "/C=KG/O=Bazaar/CN=Bazaar POS QZ Self-Signed"
```

Do not commit either file. Treat `qz-private-key.pem` as a production secret.

## Required server configuration

Configure one public certificate value and one private key value on the server:

- `QZ_CERTIFICATE` or `QZ_CERTIFICATE_PATH`
- `QZ_PRIVATE_KEY` or `QZ_PRIVATE_KEY_PATH`

Base64 PEM variants are also supported:

- `QZ_CERTIFICATE_BASE64`
- `QZ_PRIVATE_KEY_BASE64`

Legacy deployment aliases remain supported:

- `QZ_TRAY_CERTIFICATE`
- `QZ_TRAY_CERTIFICATE_BASE64`
- `QZ_TRAY_CERTIFICATE_PATH`
- `QZ_TRAY_PRIVATE_KEY`
- `QZ_TRAY_PRIVATE_KEY_BASE64`
- `QZ_TRAY_PRIVATE_KEY_PATH`

The private key is read only by the server-side signing endpoint and must never be exposed to the browser bundle.

For `.env` files, base64 values are usually safer than multiline PEM:

```bash
base64 -i bazaar-qz-certificate.txt
base64 -i qz-private-key.pem
```

Then configure:

```env
QZ_CERTIFICATE_BASE64="..."
QZ_PRIVATE_KEY_BASE64="..."
```

## Runtime flow

1. The browser fetches `/api/qz/status` to check whether certificate and signing key are configured.
2. If configured, the browser fetches the public certificate from `/api/qz/certificate`.
3. The QZ client calls `/api/qz/sign` for each QZ message that must be signed.
4. The server signs the exact QZ message with RSA SHA-512 and returns a base64 signature.
5. Bazaar validates that the configured certificate and private key are a matching pair before claiming signing is ready.

If certificate or key configuration is missing, Bazaar can still attempt QZ printing, but QZ will show Allow/Block because the request is untrusted.

## QZ workstation setup

The cashier machine must have QZ Tray installed and running. For silent production printing, QZ must also trust the Bazaar certificate.

Provision each terminal with the same public certificate that Bazaar serves from `/api/qz/certificate`.

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

Restart QZ Tray after provisioning.

## Verification

Open `/settings/printing` and confirm:

- QZ Tray connected.
- Bazaar certificate loaded.
- Request signing works.
- This terminal is marked as provisioned after the certificate was installed.
- Test print completes without an Allow/Block popup.

If QZ still shows a dialog, open request details:

- `Signature` should not be `Missing`.
- `Validity` should not be `Invalid`.
- `Certificate Common Name` should show the certificate CN, not anonymous request.
- `Trusted` should not say untrusted website after terminal provisioning.

If `Signature` is missing, Bazaar did not receive/use `QZ_PRIVATE_KEY`.
If the certificate is anonymous, Bazaar did not receive/use `QZ_CERTIFICATE`.
If validity is invalid, the private key does not match the certificate or QZ is using a different certificate than the terminal trusts.
