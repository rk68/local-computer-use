#!/usr/bin/env python3
"""Build the missing pinned Cua network helper inside .cache, without sudo."""
import hashlib
import os
from pathlib import Path
import platform
import subprocess
import sys
import tarfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache/cua-netgw'
SOURCE_COMMIT = 'a4ec97ee94dc04332dacbca635886e03d8c27e8d'
GO_FILE = 'go1.26.10.darwin-arm64.tar.gz'
GO_SHA256 = '0b5183492292ada170f9b561a834863808dd02edba599e4ad0e89899330020b3'


def main():
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise SystemExit('This gateway setup supports Apple silicon Macs. Configure CUA_NETGW explicitly on other systems.')
    CACHE.mkdir(parents=True, exist_ok=True)
    binary = CACHE / 'cua-netgw'
    if binary.is_file():
        result = subprocess.run([str(binary), '-version'], capture_output=True, text=True, check=True)
        if result.stdout.strip() == 'cua-netgw 0.21.0':
            print('Project-local Cua gateway: ready')
            return
        raise SystemExit('Unexpected gateway version. Remove only .cache/cua-netgw/cua-netgw and rerun setup.')
    archive = CACHE / GO_FILE
    if not archive.exists():
        print('Downloading a verified Go toolchain into the project cache.', flush=True)
        temporary = archive.with_suffix('.part')
        with urlopen('https://go.dev/dl/' + GO_FILE, timeout=60) as response, temporary.open('wb') as file:
            while chunk := response.read(1024 * 1024):
                file.write(chunk)
        temporary.replace(archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != GO_SHA256:
        raise SystemExit('Go toolchain checksum mismatch. No downloaded code was executed.')
    toolchain = CACHE / 'toolchain'
    compiler = toolchain / 'go/bin/go'
    if not compiler.is_file():
        toolchain.mkdir(exist_ok=True)
        with tarfile.open(archive) as file:
            file.extractall(toolchain, filter='data')
    source = CACHE / 'source'
    if not source.exists():
        subprocess.run(['git', 'clone', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', 'cua-sdk-v0.21.0',
                        'https://github.com/trycua/cua.git', str(source)], check=True)
    commit = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if commit != SOURCE_COMMIT:
        raise SystemExit('Cua source revision mismatch. Build stopped.')
    subprocess.run(['git', '-C', str(source), 'sparse-checkout', 'set', 'libs/cua/netgw'], check=True)
    environment = dict(os.environ, GOTOOLCHAIN='local', GOMAXPROCS='2', GOMEMLIMIT='512MiB', CGO_ENABLED='0',
                       GOPATH=str(CACHE / 'gopath'), GOCACHE=str(CACHE / 'build-cache'))
    print('Building the network gateway with two build workers.', flush=True)
    subprocess.run([str(compiler), 'build', '-p', '2', '-trimpath', '-ldflags', '-s -w -X main.version=0.21.0',
                    '-o', str(binary), './cmd/cua-netgw'], cwd=source / 'libs/cua/netgw', env=environment, check=True)
    subprocess.run(['codesign', '--force', '--sign', '-', '--identifier', 'ai.cua.netgw', str(binary)], check=True)
    subprocess.run([str(binary), '-version'], check=True)


if __name__ == '__main__':
    main()
