"""Bridge the released cua-sandbox facade to the pinned native SDK.

The 0.9.1 facade still uses fleet_from_env=False; SDK 0.21.0 names
that security choice account_from_session=False. Keep this workaround
inside the app instead of editing installed packages or enabling account access.
"""
from functools import wraps
from importlib.metadata import version
import inspect
import logging
from pathlib import Path
import threading

_LOCK = threading.Lock()
_INSTALLED = False


def prepare():
    global _INSTALLED
    with _LOCK:
        if _INSTALLED:
            return
        import cua
        from cua_sandbox import _sdk
        versions = (version('cua-sandbox'), version('cua'))
        if versions != ('0.9.1', '0.21.0'):
            raise RuntimeError(f'Unsupported Cua versions: {versions}. Run bash scripts/poc.sh setup.')
        embedded = cua.embedded
        if 'fleet_from_env' in inspect.signature(embedded).parameters:
            raise RuntimeError('Unexpected SDK contract. Refusing to apply the Cua compatibility adapter.')
        original = _sdk.sdk
        home = Path(__file__).resolve().parents[1] / '.cache/cua-poc'

        class SDKView:
            def __getattr__(self, name):
                return getattr(cua, name)

            def embedded(self, *, state_dir=None, fleet_from_env=False):
                if fleet_from_env is not False:
                    raise ValueError('This app forbids loading a Cua account from the environment.')
                return embedded(state_dir=state_dir, account_from_session=False,
                                spaces_home=str(home), teleport_home=str(home))

        view = SDKView()

        @wraps(original)
        def sdk():
            original()  # retain the facade's native-library validation
            return view

        _sdk.sdk = sdk
        _INSTALLED = True
        logging.getLogger('holo.poc').info('Cua compatibility ready: sandbox=%s sdk=%s', *versions)


def check():
    """Construct the real embedded runtime without starting or listing any guest."""
    prepare()
    from cua_sandbox import _sdk, sandbox_state
    result = _sdk.runtime(state_dir=sandbox_state.state_dir())
    print('Cua runtime contract: OK (' + type(result).__name__ + ')')


if __name__ == '__main__':
    check()
