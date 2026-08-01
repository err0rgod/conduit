document.addEventListener('DOMContentLoaded', () => {
  const portInput = document.getElementById('port') as HTMLInputElement;
  const codeInput = document.getElementById('code') as HTMLInputElement;
  const saveBtn = document.getElementById('save') as HTMLButtonElement;
  const status = document.getElementById('status') as HTMLParagraphElement;

  chrome.storage.local.get(['daemonPort'], (result) => {
    if (result.daemonPort) portInput.value = result.daemonPort;
  });

  saveBtn.addEventListener('click', async () => {
    const port = parseInt(portInput.value, 10);
    const code = codeInput.value.trim().toUpperCase();
    saveBtn.disabled = true;
    status.textContent = 'Pairing with the local daemon…';
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/extension/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const value: unknown = await response.json();
      if (!response.ok || !hasToken(value)) {
        throw new Error(readError(value));
      }
      await chrome.storage.local.set({ daemonPort: port, daemonToken: value.token });
      codeInput.value = '';
      status.textContent = 'Paired. Conduit is connecting securely.';
      saveBtn.textContent = 'Paired';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Pairing failed.';
      saveBtn.textContent = 'Pair & Connect';
    } finally {
      saveBtn.disabled = false;
    }
  });
});

function hasToken(value: unknown): value is { token: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'token' in value &&
    typeof value.token === 'string' &&
    /^[a-f0-9]{64}$/u.test(value.token)
  );
}

function readError(value: unknown): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'object' &&
    value.error !== null &&
    'message' in value.error &&
    typeof value.error.message === 'string'
  ) {
    return value.error.message;
  }
  return 'Pairing failed. Check the code and daemon port.';
}
