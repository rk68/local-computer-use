"""Locate the project-local Cua gateway without weakening the VM network policy."""
import os
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
GATEWAY = ROOT / '.cache/cua-netgw/cua-netgw'


def configure():
    if not os.environ.get('CUA_NETGW') and GATEWAY.is_file():
        os.environ['CUA_NETGW'] = str(GATEWAY)


def ensure_available():
    configure()
    candidate = os.environ.get('CUA_NETGW') or shutil.which('cua-netgw')
    if not candidate or not Path(candidate).is_file() or not os.access(candidate, os.X_OK):
        raise ValueError('Online mode needs the Cua network gateway. Run: bash scripts/poc.sh setup. Then restart the app. Offline mode still works.')
