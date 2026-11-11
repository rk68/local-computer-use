// The pinned Convex CLI does not expose the backend's --interface option.
// Scope this preload to Halo's CLI process. Do not patch installed packages.
const childProcess = require('node:child_process');
const { basename } = require('node:path');
const { syncBuiltinESMExports } = require('node:module');
for (const method of ['spawn', 'spawnSync']) {
  const original = childProcess[method];
  childProcess[method] = function (command, args, options) {
    if (basename(String(command)) === 'convex-local-backend') {
      args = ['--interface', '127.0.0.1', '--disable-beacon', ...(args ?? [])];
    }
    return original.call(this, command, args, options);
  };
}
syncBuiltinESMExports();
