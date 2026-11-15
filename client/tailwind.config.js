/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Atkinson Hyperlegible"', 'system-ui', 'sans-serif'] },
      colors: {
        ink: '#1d2733',
        muted: '#5d6b7a',
        line: '#d6dce4',
        paper: '#f4f6f8',
        brand: { DEFAULT: '#24557a', dark: '#1a4260' },
      },
    },
  },
  plugins: [],
};
