"""Remove only the guest recorded as owned by this proof of concept."""
import asyncio
import sys
from app.core import Desk, OWNED


async def main():
    markers = ([OWNED] if OWNED.exists() else []) + sorted((OWNED.parent / 'threads').glob('*.json'))
    if not markers:
        print('No POC guest is recorded. Nothing to remove.')
        return 0
    failed = False
    for marker in markers:
        import re
        if marker != OWNED and not re.fullmatch(r'[a-z0-9]{20,64}\.json', marker.name):
            print('Skipped an invalid thread ownership filename.', file=sys.stderr)
            failed = True
            continue
        desk = Desk(owned=marker)
        await desk.stop()
        if desk.error:
            print(desk.error, file=sys.stderr)
            failed = True
    if failed:
        return 1
    print('Removed the POC guest. Downloaded image caches remain available for reuse.')
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
