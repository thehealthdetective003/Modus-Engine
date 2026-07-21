import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { SettingsProvider } from './components/SettingsContext';
import { TooltipProvider } from '@/components/ui/tooltip';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" attribute="class">
      <SettingsProvider>
        <TooltipProvider>
          <App />
          <Toaster />
        </TooltipProvider>
      </SettingsProvider>
    </ThemeProvider>
  </StrictMode>,
);
