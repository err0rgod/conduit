import * as os from 'node:os';
import * as path from 'node:path';

export function getAppDataDir(): string {
  const platform = os.platform();
  const homedir = os.homedir();
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming'), 'Conduit');
  }
  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support', 'Conduit');
  }
  return path.join(homedir, '.config', 'conduit');
}
