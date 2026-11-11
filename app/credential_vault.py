"""Origin-scoped credentials. Secrets use the macOS Keychain, never SQLite."""
import json
import re
from urllib.parse import urlsplit

SERVICE = 'hololocal.web-login.v1'


def website_origin(value):
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError('Enter an HTTPS website address.')
    try:
        url = urlsplit(value)
        port = url.port
        if (url.scheme != 'https' or not url.hostname or url.username or url.password
                or port not in (None, 443) or not re.fullmatch(r'[a-zA-Z0-9.-]+', url.hostname)):
            raise ValueError
        return 'https://' + url.hostname.lower().rstrip('.')
    except ValueError:
        raise ValueError('Credentials require an HTTPS website on port 443, without URL credentials.') from None


class CredentialVault:
    def __init__(self, backend=None):
        self._backend = backend

    def backend(self):
        if self._backend is None:
            try:
                # Select the OS backend explicitly. Never fall back to a plaintext keyring.
                from keyring.backends.macOS import Keyring
                self._backend = Keyring()
            except Exception:
                raise ValueError('macOS Keychain is unavailable. Run bash scripts/poc.sh setup.') from None
        return self._backend

    def save(self, origin, username, password):
        origin = website_origin(origin)
        if not isinstance(username, str) or not 1 <= len(username) <= 320 or not isinstance(password, str) or not 1 <= len(password) <= 4096:
            raise ValueError('Enter an email or username and a password.')
        try:
            self.backend().set_password(SERVICE, origin, json.dumps({'username': username, 'password': password}))
        except Exception:
            raise ValueError('Could not save the account in macOS Keychain.') from None

    def read(self, origin):
        try:
            value = self.backend().get_password(SERVICE, website_origin(origin))
            if value is None:
                raise ValueError
            result = json.loads(value)
            if (not isinstance(result, dict) or set(result) != {'username', 'password'}
                    or any(not isinstance(v, str) or not v for v in result.values())):
                raise ValueError
            return result
        except Exception:
            raise ValueError('No saved account is available for this exact website.') from None

    def delete(self, origin):
        try:
            self.backend().delete_password(SERVICE, website_origin(origin))
        except Exception:
            raise ValueError('Could not remove the saved account from macOS Keychain.') from None
