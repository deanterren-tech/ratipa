import { ErrorBoundary } from "./ErrorBoundary";
import { installGlobalErrorHandlers } from "./utils/appErrors";
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Падения вне React и сбои загрузки кода после обновления тоже попадают в журнал.
installGlobalErrorHandlers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </StrictMode>,
);
