/**
 * React Renderer Entry Point
 *
 * Mounts the React application into the #root DOM element.
 * Imports global styles (Tailwind).
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { migrateLegacyConnectionConfig } from './lib/connection-config-migration';
import './index.css';

// Move any plaintext connection secrets out of localStorage before the UI loads.
void migrateLegacyConnectionConfig();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
