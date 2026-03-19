export interface NavigationSeedLink {
  title: string;
  url: string;
  description: string;
}

export interface NavigationSeedCategory {
  name: string;
  links: NavigationSeedLink[];
}

export const NAVIGATION_SEED: NavigationSeedCategory[] = [
  {
    name: '常用推荐',
    links: [
      { title: 'GitHub', url: 'https://github.com', description: '代码托管平台' },
      { title: 'ChatGPT', url: 'https://chat.openai.com', description: 'OpenAI 对话 AI' },
      { title: 'YouTube', url: 'https://www.youtube.com', description: '全球视频平台' },
      { title: 'Notion', url: 'https://www.notion.so', description: '全能笔记工具' }
    ]
  },
  {
    name: '开发工具',
    links: [
      { title: 'Stack Overflow', url: 'https://stackoverflow.com', description: '开发者问答社区' },
      { title: 'VS Code Web', url: 'https://vscode.dev', description: '在线 VS Code' },
      { title: 'npm', url: 'https://www.npmjs.com', description: 'Node 包管理器' },
      { title: 'Docker Hub', url: 'https://hub.docker.com', description: '容器镜像仓库' }
    ]
  },
  {
    name: '技术文档',
    links: [
      { title: 'MDN Web Docs', url: 'https://developer.mozilla.org', description: 'Web 技术权威文档' },
      { title: 'Vue.js', url: 'https://vuejs.org', description: 'Vue 官方文档' },
      { title: 'TypeScript', url: 'https://www.typescriptlang.org', description: 'TS 官方文档' },
      { title: 'Vite', url: 'https://vitejs.dev', description: '前端构建工具' }
    ]
  },
  {
    name: 'AI工具',
    links: [
      { title: 'Claude', url: 'https://claude.ai', description: 'Anthropic 对话 AI' },
      { title: 'Hugging Face', url: 'https://huggingface.co', description: 'AI 模型社区' },
      { title: 'Perplexity', url: 'https://www.perplexity.ai', description: 'AI 搜索引擎' },
      { title: 'Gemini', url: 'https://gemini.google.com', description: 'Google AI 助手' }
    ]
  },
  {
    name: '设计资源',
    links: [
      { title: 'Figma', url: 'https://www.figma.com', description: '协作设计工具' },
      { title: 'Behance', url: 'https://www.behance.net', description: 'Adobe 创意社区' },
      { title: 'Unsplash', url: 'https://unsplash.com', description: '免费高清图片' },
      { title: 'Canva', url: 'https://www.canva.com', description: '在线设计平台' }
    ]
  },
  {
    name: '云服务',
    links: [
      { title: 'AWS', url: 'https://aws.amazon.com', description: '亚马逊云服务' },
      { title: 'Cloudflare', url: 'https://www.cloudflare.com', description: 'CDN 和安全服务' },
      { title: 'Vercel', url: 'https://vercel.com', description: '前端部署平台' },
      { title: 'Supabase', url: 'https://supabase.com', description: '开源 Firebase 替代' }
    ]
  }
];
