document.addEventListener('DOMContentLoaded', () => {
  const portInput = document.getElementById('port') as HTMLInputElement;
  const tokenInput = document.getElementById('token') as HTMLInputElement;
  const saveBtn = document.getElementById('save') as HTMLButtonElement;

  chrome.storage.local.get(['daemonPort', 'daemonToken'], (result) => {
    if (result.daemonPort) portInput.value = result.daemonPort;
    if (result.daemonToken) tokenInput.value = result.daemonToken;
  });

  saveBtn.addEventListener('click', () => {
    const port = parseInt(portInput.value, 10);
    const token = tokenInput.value;

    chrome.storage.local.set(
      {
        daemonPort: port,
        daemonToken: token,
      },
      () => {
        saveBtn.textContent = 'Saved!';
        setTimeout(() => {
          saveBtn.textContent = 'Save & Connect';
        }, 2000);
      },
    );
  });
});
