import React from 'react';
import ReactDOM from 'react-dom/client';

async function loadClient() {
  const contracts = await import('./protocol/contracts');
  await contracts.loadContracts();
  document.documentElement.dataset.shell = 'next';
  return import('./App');
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('AlphaStudio requires a #root mount element.');
}

loadClient().then(({ default: App }) => {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}).catch((error) => {
  window.setTimeout(() => {
    throw error;
  });
});
