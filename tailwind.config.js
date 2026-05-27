/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: { '2xl': '1280px' },
    },
    extend: {
      fontFamily: {
        sans: ['"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        // Status pill tints — driven by CSS variables so they invert in dark mode.
        status: {
          pending:        'hsl(var(--status-pending))',
          'pending-fg':   'hsl(var(--status-pending-fg))',
          received:       'hsl(var(--status-received))',
          'received-fg':  'hsl(var(--status-received-fg))',
          flyer:          'hsl(var(--status-flyer))',
          'flyer-fg':     'hsl(var(--status-flyer-fg))',
          transit:        'hsl(var(--status-transit))',
          'transit-fg':   'hsl(var(--status-transit-fg))',
          delivered:      'hsl(var(--status-delivered))',
          'delivered-fg': 'hsl(var(--status-delivered-fg))',
          awaiting:       'hsl(var(--status-awaiting))',
          'awaiting-fg':  'hsl(var(--status-awaiting-fg))',
          paid:           'hsl(var(--status-paid))',
          'paid-fg':      'hsl(var(--status-paid-fg))',
          cancelled:      'hsl(var(--status-cancelled))',
          'cancelled-fg': 'hsl(var(--status-cancelled-fg))',
        },
      },
      borderRadius: {
        xl: '0.875rem',
        lg: '0.625rem',
        md: '0.5rem',
        sm: '0.375rem',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(15 23 42 / 0.04)',
        DEFAULT: '0 1px 3px 0 rgb(15 23 42 / 0.05), 0 1px 2px -1px rgb(15 23 42 / 0.04)',
        md: '0 4px 12px -2px rgb(15 23 42 / 0.06), 0 2px 4px -2px rgb(15 23 42 / 0.04)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 hsl(var(--primary) / 0.4)' },
          '70%': { boxShadow: '0 0 0 10px hsl(var(--primary) / 0)' },
          '100%': { boxShadow: '0 0 0 0 hsl(var(--primary) / 0)' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fade-in 0.25s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
