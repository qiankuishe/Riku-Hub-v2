#!/bin/bash

# Riku-Hub 一键部署脚本
# 功能：构建前端 -> 部署到 Cloudflare -> 提交代码 -> 推送到 GitHub

set -e  # 遇到错误立即退出

echo "🚀 开始部署 Riku-Hub..."
echo ""

# 1. 构建前端
echo "📦 步骤 1/4: 构建前端..."
cd packages/web
npm run build
cd ../..
echo "✅ 前端构建完成"
echo ""

# 2. 部署到 Cloudflare
echo "☁️  步骤 2/4: 部署到 Cloudflare Workers..."
npx wrangler deploy
echo "✅ 部署完成"
echo ""

# 等待 2 秒
echo "⏳ 等待 2 秒后提交代码..."
sleep 2
echo ""

# 3. 提交代码
echo "💾 步骤 3/4: 提交代码..."
git add -A

# 检查是否有改动
if git diff --staged --quiet; then
  echo "⚠️  没有需要提交的改动"
else
  # 获取提交信息（如果有参数则使用，否则使用默认信息）
  if [ -z "$1" ]; then
    COMMIT_MSG="chore: 部署更新 $(date '+%Y-%m-%d %H:%M:%S')"
  else
    COMMIT_MSG="$1"
  fi
  
  git commit -m "$COMMIT_MSG"
  echo "✅ 代码已提交: $COMMIT_MSG"
fi
echo ""

# 4. 推送到 GitHub
echo "📤 步骤 4/4: 推送到 GitHub..."
git push
echo "✅ 代码已推送"
echo ""

echo "🎉 全部完成！"
echo "🌐 访问地址: https://dh.300031.xyz"
