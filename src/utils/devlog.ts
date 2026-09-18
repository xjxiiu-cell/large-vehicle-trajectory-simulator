/**
 * 开发日志工具
 * 每天自动记录完成事项和待办事项到 /devlog/YYYY-MM-DD.md
 */

interface LogEntry {
  timestamp: string;
  type: 'done' | 'todo' | 'issue' | 'note';
  content: string;
}

function getTodayFilename(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}.md`;
}

function formatTime(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * 记录一条日志条目
 * 注意：在浏览器环境中无法直接写文件，此工具将日志输出到 console
 * 并通过 localStorage 暂存，方便后续导出
 */
export function logEntry(type: LogEntry['type'], content: string): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    type,
    content,
  };

  // 输出到控制台
  const emoji = { done: '✅', todo: '📋', issue: '🐛', note: '📝' };
  console.log(`[DevLog ${formatTime()}] ${emoji[type]} ${content}`);

  // 存储到 localStorage
  const key = `devlog_${getTodayFilename()}`;
  const existing = JSON.parse(localStorage.getItem(key) || '[]');
  existing.push(entry);
  localStorage.setItem(key, JSON.stringify(existing));
}

/**
 * 获取今日所有日志
 */
export function getTodayLogs(): LogEntry[] {
  const key = `devlog_${getTodayFilename()}`;
  return JSON.parse(localStorage.getItem(key) || '[]');
}

/**
 * 导出开发日志为 Markdown 文本
 */
export function exportDevLog(): string {
  const today = getTodayFilename();
  const entries = getTodayLogs();
  if (entries.length === 0) return '';

  let md = `# 开发日志 - ${today}\n\n`;
  md += `## 已完成\n\n`;
  entries
    .filter((e) => e.type === 'done')
    .forEach((e) => {
      md += `- [${formatTime()}] ${e.content}\n`;
    });

  md += `\n## 待办事项\n\n`;
  entries
    .filter((e) => e.type === 'todo')
    .forEach((e) => {
      md += `- [ ] ${e.content}\n`;
    });

  md += `\n## 问题与备注\n\n`;
  entries
    .filter((e) => e.type === 'issue' || e.type === 'note')
    .forEach((e) => {
      md += `- [${formatTime()}] ${e.content}\n`;
    });

  return md;
}

/**
 * 初始化开发日志系统（在应用启动时调用）
 */
export function initDevLog(): void {
  console.log(`[DevLog] 开发日志系统已启动 - ${getTodayFilename()}`);
  logEntry('note', '开发日志系统初始化');
}
