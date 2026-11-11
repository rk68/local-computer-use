"""Real installed binding checks, without guest creation or network access."""
from importlib.metadata import PackageNotFoundError, version
import tempfile
import unittest


def installed():
    try:
        return version('cua-sandbox') == '0.9.1' and version('cua') == '0.21.0'
    except PackageNotFoundError:
        return False


@unittest.skipUnless(installed(), 'Pinned optional Cua dependencies are not installed')
class CuaContract(unittest.TestCase):
    def test_real_runtime_constructs_without_legacy_argument_error(self):
        from app.cua_compat import prepare
        prepare()
        from cua_sandbox import _sdk
        with tempfile.TemporaryDirectory() as folder:
            runtime = _sdk.runtime(state_dir=folder)
            self.assertEqual(type(runtime).__name__, 'Cua')
            self.assertIs(runtime, _sdk.runtime(state_dir=folder))

    def test_account_environment_access_is_explicitly_blocked(self):
        from app.cua_compat import prepare
        prepare()
        from cua_sandbox import _sdk
        with self.assertRaises(ValueError):
            _sdk.sdk().embedded(fleet_from_env=True)


if __name__ == '__main__':
    unittest.main()
