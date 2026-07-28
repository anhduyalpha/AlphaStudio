import React from 'react';
import ReactDOM from 'react-dom/client';

async function loadClient() {
  if (import.meta.env.VITE_UI === 'next') {
    const contracts = await import('./protocol/contracts');
    await contracts.loadContracts();
    return import('./next/App');
  }

  await Promise.all([
    import('./styles.css'),
    import('./animations/index.css'),
  ]);
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
