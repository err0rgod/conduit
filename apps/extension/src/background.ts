import { RequestEnvelope, ResponseEnvelope } from '@conduit/protocol';

let daemonSocket: WebSocket | null = null;
let reconnectTimer: any = null;

function connectDaemon() {
  if (daemonSocket) return;

  chrome.storage.local.get(['daemonPort', 'daemonToken'], (result) => {
    const port = result.daemonPort || 9222;
    const token = result.daemonToken;

    if (!token) {
      console.log('No daemon token available. Waiting for configuration.');
      return;
    }

    try {
      daemonSocket = new WebSocket(`ws://127.0.0.1:${port}`);

      daemonSocket.onopen = () => {
        console.log('Connected to daemon');
        daemonSocket?.send(JSON.stringify({ type: 'auth', payload: { token } }));
      };

      daemonSocket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'auth_success') {
          console.log('Successfully authenticated with daemon');
          chrome.action.setBadgeText({ text: 'ON' });
          chrome.action.setBadgeBackgroundColor({ color: '#00FF00' });
        } else if (msg.type === 'error' && msg.error?.code === 'AUTHENTICATION_FAILED') {
          console.error('Authentication failed with daemon');
          daemonSocket?.close();
        } else {
          handleDaemonMessage(msg);
        }
      };

      daemonSocket.onclose = () => {
        console.log('Disconnected from daemon');
        daemonSocket = null;
        chrome.action.setBadgeText({ text: 'OFF' });
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });

        // Reconnect after a delay
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectDaemon, 5000);
      };

      daemonSocket.onerror = (error) => {
        console.error('Daemon connection error', error);
      };
    } catch (e) {
      console.error('Failed to connect to daemon', e);
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectDaemon, 5000);
    }
  });
}

function handleDaemonMessage(msg: any) {
  // Skeleton for handling messages from daemon
  console.log('Received message from daemon:', msg);
}

// Initial connection attempt
connectDaemon();

// Listen for updates to configuration
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.daemonToken || changes.daemonPort)) {
    if (daemonSocket) {
      daemonSocket.close();
    } else {
      connectDaemon();
    }
  }
});
