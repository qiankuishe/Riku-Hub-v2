import { defineConfig, presetUno, presetAttributify, presetIcons } from 'unocss'

export default defineConfig({
  presets: [
    presetUno(),
    presetAttributify(),
    presetIcons({
      scale: 1.2,
      cdn: 'https://esm.sh/',
      collections: {
        carbon: () => import('@iconify-json/carbon/icons.json').then(i => i.default)
      }
    })
  ],
  theme: {
    colors: {
      primary: {
        50: '#fef7f0',
        100: '#fde9d8',
        200: '#fbd0b0',
        300: '#f8b07d',
        400: '#f48948',
        500: '#f06d23',
        600: '#e15419',
        700: '#bb3f17',
        800: '#95341a',
        900: '#792d18'
      }
    },
    breakpoints: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px'
    }
  },
  shortcuts: {
    // 按钮
    'btn': 'px-4 py-2 rounded-lg font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
    'btn-primary': 'btn bg-primary-500 text-white hover:bg-primary-600 active:bg-primary-700',
    'btn-secondary': 'btn bg-gray-200 text-gray-800 hover:bg-gray-300 active:bg-gray-400',
    'btn-tertiary': 'btn bg-transparent text-gray-600 hover:bg-gray-100 active:bg-gray-200',
    'btn-danger': 'btn bg-red-500 text-white hover:bg-red-600 active:bg-red-700',
    'btn-sm': 'px-3 py-1.5 text-sm',
    'btn-lg': 'px-6 py-3 text-lg',

    // 卡片
    'card': 'p-6 rounded-xl bg-white border border-gray-200 shadow-sm',
    'card-hover': 'card hover:shadow-md transition-shadow duration-200',

    // 输入框
    'input': 'w-full px-4 py-2 rounded-lg border border-gray-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 outline-none transition-all duration-200',
    'textarea': 'input resize-none',
    'select': 'input cursor-pointer',

    // 布局
    'container': 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8',
    'flex-center': 'flex items-center justify-center',
    'flex-between': 'flex items-center justify-between',

    // 文本
    'text-muted': 'text-gray-500 text-sm',
    'text-danger': 'text-red-500',
    'text-success': 'text-green-500',

    // 链接
    'link': 'text-primary-500 hover:text-primary-600 underline cursor-pointer'
  },
  safelist: [
    // 确保常用类不被 tree-shaking
    'bg-primary-500',
    'text-primary-500',
    'border-primary-500'
  ]
})
