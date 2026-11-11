"""Gateway lookup fails closed without changing the network policy."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from app import network_gateway


class GatewayLookup(unittest.TestCase):
    def test_missing_gateway_explains_setup_without_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(network_gateway, 'GATEWAY', Path(directory) / 'missing'), patch.dict(os.environ, {'CUA_NETGW': ''}), patch.object(network_gateway.shutil, 'which', return_value=None):
                with self.assertRaisesRegex(ValueError, 'scripts/poc.sh setup'):
                    network_gateway.ensure_available()

    def test_local_gateway_is_selected_without_system_install(self):
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / 'cua-netgw'
            binary.write_text('not executed by this check')
            binary.chmod(0o755)
            with patch.object(network_gateway, 'GATEWAY', binary), patch.dict(os.environ, {'CUA_NETGW': ''}):
                network_gateway.ensure_available()
                self.assertEqual(os.environ['CUA_NETGW'], str(binary))
