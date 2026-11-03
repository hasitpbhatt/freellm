/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        line: 'var(--border)',
        content: 'var(--text)',
        muted: 'var(--text-muted)',
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
        },
        gain: 'var(--green)',
        loss: 'var(--red)',
        warn: 'var(--amber)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', '1.4'],   // 10px
        xs: ['0.6875rem', '1.45'],    // 11px
        sm: ['0.8125rem', '1.5'],     // 13px
        base: ['1rem', '1.55'],       // 16px
        lg: ['1.125rem', '1.5'],      // 18px
        xl: ['1.25rem', '1.5'],       // 20px
        '2xl': ['1.5rem', '1.4'],     // 24px
        '3xl': ['1.875rem', '1.3'],   // 30px
      },
    },
  },
  plugins: [],
}
