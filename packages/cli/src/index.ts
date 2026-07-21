import { Command } from 'commander';
import { LocalAuth } from '@conduit/security';

const program = new Command();
program.name('conduit').description('Conduit CLI').version('0.1.0');

const auth = new LocalAuth();

async function sendCommand(action: any) {
  try {
    const res = await fetch('http://127.0.0.1:9222/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    if (!res.ok) {
      console.error(`Error: ${res.statusText}`);
      const text = await res.text();
      console.error(text);
      process.exit(1);
    }
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to communicate with daemon', e);
    process.exit(1);
  }
}

program
  .command('daemon')
  .description('Daemon operations')
  .command('status')
  .action(async () => {
    console.log('Token:', auth.ensureToken());
    console.log('Sending ping to daemon...');
    await sendCommand({ type: 'ping' });
  });

const browserCmd = program.command('browser').description('Browser operations');

browserCmd.command('tabs').action(() => sendCommand({ type: 'list_tabs' }));

browserCmd
  .command('open <url>')
  .action((url) => sendCommand({ type: 'open_tab', payload: { url } }));

program.parse();
