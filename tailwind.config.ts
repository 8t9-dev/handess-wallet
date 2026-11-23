import type { Config } from 'tailwindcss';
import forms from '@tailwindcss/forms';

export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Brand colors - Handshake / Handess Wallet inspired
        hns: {
          50: '#f0f4ff',
          100: '#dbe4ff',
          200: '#bac8ff',
          300: '#91a7ff',
          400: '#748ffc',
          500: '#5c7cfa',
          600: '#4c6ef5',
          700: '#4263eb',
          800: '#3b5bdb',
          900: '#364fc7',
        },
        // Semantic colors for domain states
        state: {
          available: '#10b981',   // green - can be opened
          bidding: '#f59e0b',     // amber - auction in progress
          reveal: '#f97316',      // orange - reveal phase
          closed: '#3b82f6',      // blue - owned/registered
          transfer: '#8b5cf6',    // purple - transfer in progress
          revoked: '#ef4444',     // red - permanently revoked
          reserved: '#6b7280',    // gray - ICANN reserved
          expiring: '#ef4444',    // red - expiry warning
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [forms],
} satisfies Config;
