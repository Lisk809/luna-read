import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import { marked } from 'marked';
import Handlebars from 'handlebars';
import emailjs from '@emailjs/nodejs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置：issues 目录路径
const ISSUES_DIR = path.resolve(__dirname, '../issues');
const TEMPLATE_PATH = path.resolve(__dirname, '../templates/magazine.html');

// 从 D1 获取所有订阅者邮箱（active 状态）
async function fetchSubscribersFromD1() {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/d1/database/${process.env.CF_DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sql: 'SELECT email FROM subscribers WHERE status = "active"'
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`D1 API Error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  // D1 返回结构：{ result: [ { results: [ { email: '...' }, ... ] } ] }
  const rows = data.result[0]?.results || [];
  return rows.map(row => row.email);
}

// 获取最新的 issue 文件（按文件名排序，取最后一个）
function getLatestIssueFile() {
  const files = fs.readdirSync(ISSUES_DIR)
    .filter(f => f.endsWith('.md'))
    .sort(); // 按名称升序（如 2026-08-09-issue-1.md 自然排序）
  if (files.length === 0) {
    throw new Error('No issue markdown files found in issues/');
  }
  return path.join(ISSUES_DIR, files[files.length - 1]);
}

// 渲染邮件 HTML
function renderEmail(frontmatter, contentHtml) {
  const templateStr = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const template = Handlebars.compile(templateStr);

  // 准备数据
  const data = {
    magazine_name: frontmatter.magazine_name || '标准之味',
    issue: frontmatter.issue || 'Issue #01',
    date: frontmatter.date || new Date().toISOString().slice(0,10).replace(/-/g,'.'),
    title: frontmatter.title || '无标题',
    subtitle: frontmatter.subtitle || '',
    cover_image: frontmatter.cover_image || '',
    accent_color: frontmatter.accent_color || '#E11D48',
    layout: frontmatter.layout || 'left-image',
    content_html: contentHtml,
    unsubscribe_url: '#', // 稍后替换为真实退订链接（可用 Worker）
  };

  return template(data);
}

// 主函数
async function main() {
  try {
    // 1. 获取最新一期 markdown
    const filePath = getLatestIssueFile();
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const { data: frontmatter, content } = matter(fileContent);

    // 2. 将 Markdown 正文转为 HTML（启用 GFM 和 表格支持）
    marked.setOptions({
      gfm: true,
      breaks: true,
    });
    const contentHtml = marked(content);

    // 3. 渲染邮件 HTML
    const emailHtml = renderEmail(frontmatter, contentHtml);

    // 4. 从 D1 获取订阅者列表
    const subscribers = await fetchSubscribersFromD1();
    console.log(`准备推送至 ${subscribers.length} 位订阅者`);

    if (subscribers.length === 0) {
      console.log('无订阅者，退出流程。');
      return;
    }

    // 5. 批量发送（分批，每批 5 个并发）
    const batchSize = 5;
    for (let i = 0; i < subscribers.length; i += batchSize) {
      const batch = subscribers.slice(i, i + batchSize);
      const promises = batch.map(email =>
        emailjs.send(
          process.env.EMAILJS_SERVICE_ID,
          process.env.EMAILJS_TEMPLATE_ID,
          {
            to_email: email,
            subject: frontmatter.title || '杂志更新',
            html_message: emailHtml,
          },
          {
            publicKey: process.env.EMAILJS_PUBLIC_KEY,
            privateKey: process.env.EMAILJS_PRIVATE_KEY,
          }
        ).then(() => {
          console.log(`✅ 发送成功: ${email}`);
        }).catch(err => {
          console.error(`❌ 发送失败: ${email}`, err.text || err.message);
        })
      );
      await Promise.allSettled(promises);
      console.log(`批次 ${Math.floor(i / batchSize) + 1} 完成`);
    }

    console.log('🎉 所有推送任务完成！');
  } catch (error) {
    console.error('❌ 脚本执行错误:', error);
    process.exit(1);
  }
}

main();
