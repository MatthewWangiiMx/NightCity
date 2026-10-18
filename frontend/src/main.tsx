import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import DebugErrorBoundary from '@/components/DebugErrorBoundary';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* TEMPORARY: remove DebugErrorBoundary once the blank-page crash is found. */}
    <DebugErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </DebugErrorBoundary>
  </StrictMode>,
);
