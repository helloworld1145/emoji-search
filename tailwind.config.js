/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#FF6B6B',
          50: '#FFF1F1',
          100: '#FFE0E0',
          200: '#FFC2C2',
          300: '#FF9E9E',
          400: '#FF8E53',
          500: '#FF6B6B',
          600: '#F04E4E',
          700: '#D13A3A',
          800: '#A82D2D',
          900: '#7A2222'
        },
        secondary: '#FF8E53',
        accent: '#4ECDC4',
        surface: '#F7F8FA',
        card: '#FFFFFF',
        ink: {
          DEFAULT: '#1F2933',
          muted: '#6B7280',
          faint: '#9CA3AF'
        },
        success: '#22C55E',
        danger: '#EF4444',
        warning: '#F59E0B'
      },
      fontFamily: {
        sans: [
          'PingFang SC',
          'HarmonyOS Sans SC',
          'MiSans',
          'Noto Sans SC',
          'Roboto',
          'system-ui',
          'sans-serif'
        ],
        title: [
          'LeeeafHei',
          'PingFang SC',
          'Noto Sans SC',
          'sans-serif'
        ]
        /* 狸叶黑体（LeeeafHei）现仅通过 style.css 的 h1 全局规则应用，
           如需其他元素使用可加 font-title，但请保持 h1 专属约定 */
      },
      borderRadius: {
        card: '16px',
        sheet: '24px'
      },
      boxShadow: {
        card: '0 2px 12px rgba(31, 41, 51, 0.06)',
        float: '0 8px 24px rgba(31, 41, 51, 0.12)'
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        'pop': {
          '0%': { transform: 'scale(0.9)' },
          '60%': { transform: 'scale(1.03)' },
          '100%': { transform: 'scale(1)' }
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' }
        }
      },
      animation: {
        'fade-up': 'fade-up 0.28s ease-out both',
        pop: 'pop 0.25s ease-out both',
        shimmer: 'shimmer 1.6s infinite'
      }
    }
  },
  plugins: []
}
