"""Remove only the guest recorded as owned by this proof of concept."""
import asyncio
import sys
from app.core import Desk, OWNED


async def main():
    if not OWNED.exists():
        print('No POC guest is recorded. Nothing to remove.')
        return 0
    desk = Desk()
    await desk.stop()
    if desk.error:
        print(desk.error, file=sys.stderr)
        return 1
    print('Removed the POC guest. Downloaded image caches remain available for reuse.')
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
