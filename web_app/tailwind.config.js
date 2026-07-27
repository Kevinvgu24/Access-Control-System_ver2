/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        orange: {
          DEFAULT: '#ff6d00',
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#ff6d00',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
        },
        green:   '#10b981', // true emerald green
        emerald: '#10b981', // true emerald green
        red:     '#dc2626', // vivid alert red
        amber:   '#f59e0b', // warning amber
        blue:    '#0284c7', // slate-blue
        surface: '#ffffff', // panel background
        raised:  '#f8fafc', // inner-panel background / inputs
        dark:    '#f1f5f9', // main app body background
        darker:  '#ffffff', // sidebar background
        line:    '#e2e8f0', // borders / separators
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
