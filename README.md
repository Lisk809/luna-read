# 我的杂志 — 邮箱推送系统

基于 GitHub Actions + EmailJS + Cloudflare D1 的自动化杂志推送。

## 快速开始

1. **安装依赖**：`npm install`
2. **配置环境变量**：复制 `.env.example` 为 `.env`，填入真实凭证。
3. **本地测试**：`npm run send`
4. **推送到 GitHub**，Actions 将按计划自动运行。

## 数据库准备（Cloudflare D1）

创建表：
```sql
CREATE TABLE subscribers (
  email TEXT PRIMARY KEY,
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
