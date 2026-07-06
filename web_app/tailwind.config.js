/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        green:   '#ff6d00', // vivid orange highlight
        red:     '#ff5252',
        amber:   '#ffab00',
        blue:    '#0284c7', // slate-blue
        surface: '#ffffff', // panel background
        raised:  '#f8fafc', // inner-panel background / inputs
        dark:    '#f1f5f9', // main app body background
        darker:  '#ffffff', // sidebar background
        line:    '#e2e8f0', // borders / separators
      },
      fontFamily: {
        sans: ['Syne', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
