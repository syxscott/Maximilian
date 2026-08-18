/**
 * Session Export — 借鉴 pi export-html 模板，适配 Maximilian 数据结构。
 *
 * 将 Maximilian 会话数据导出为独立的自包含 HTML 文件。
 * 完整保留 pi export-html 的交互体验：
 * - Sidebar 树形导航 + 搜索/过滤
 * - 思考块折叠/展开
 * - 工具执行状态视觉反馈
 * - Markdown 渲染 + 语法高亮
 * - 深链接 + 分享 URL
 * - 响应式移动端支持
 *
 * 使用方式：
 *   import { exportSessionToHtml } from '@max/core'
 *   const html = exportSessionToHtml({ messages, metadata })
 *   // 保存为 .html 文件或通过 iframe 嵌入
 */

import type {
  ContentBlock,
  TextBlock,
  ReasoningBlock,
  ToolCallBlock,
  ToolResultBlock,
  ImageBlock,
} from "./stream.js"
import type { Message } from "./message.js"

// ─── HTML Template ────────────────────────────────────────────────────────

const CSS_TEMPLATE = `
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --se-line-height: 18px; --se-sidebar-width: 400px; --se-sidebar-min-width: 240px; --se-sidebar-max-width: 840px; --se-sidebar-resizer-width: 6px;
  --se-accent: #7698fd; --se-success: #49c970; --se-warning: #f6c251; --se-error: #f1484f; --se-text: #ededed; --se-muted: #b4b4b4; --se-dim: rgba(255,255,255,0.08); --se-border: rgba(255,255,255,0.1); --se-border-accent: #3b5cf6; --se-selected-bg: #3a3a3a; --se-body-bg: #242424; --se-container-bg: #161616; --se-hover: #3a3a3a;
  --se-user-msg-bg: #2e2e2e; --se-user-msg-text: #ededed; --se-tool-pending-bg: #2a1f0a; --se-tool-success-bg: #0d1f12; --se-tool-error-bg: #2a0e10; --se-tool-output: #ededed; --se-thinking-text: #b4b4b4;
  --se-custom-msg-bg: #2e2e2e; --se-custom-msg-label: #a78bfa; --se-custom-msg-text: #ededed;
  --se-diff-added: #49c970; --se-diff-removed: #f1484f; --se-diff-context: #b4b4b4;
  --se-md-heading: #7698fd; --se-md-link: #a2bcff; --se-md-code: #f6c251; --se-md-quote-border: rgba(255,255,255,0.2); --se-md-quote: #b4b4b4; --se-md-list-bullet: #b4b4b4; --se-md-hr: rgba(255,255,255,0.1); --se-md-code-block-border: rgba(255,255,255,0.08);
  --se-syn-comment: #808080; --se-syn-keyword: #a78bfa; --se-syn-number: #f6c251; --se-syn-string: #49c970; --se-syn-function: #a2bcff; --se-syn-type: #f3da9b; --se-syn-variable: #ededed; --se-syn-operator: #f29b96; --se-syn-punctuation: #b4b4b4;
}
@media (prefers-color-scheme: light) {
  :root { --se-text: #1a1a1a; --se-muted: #5c5c5c; --se-dim: rgba(0,0,0,0.08); --se-border: rgba(0,0,0,0.1); --se-border-accent: #3b5cf6; --se-selected-bg: #f2f2f2; --se-body-bg: #fafafa; --se-container-bg: #f2f2f2; --se-hover: #e8e8e8; --se-user-msg-bg: #f2f2f2; --se-user-msg-text: #1a1a1a; --se-tool-pending-bg: #fff8e0; --se-tool-success-bg: #f0fff0; --se-tool-error-bg: #fff0f0; --se-tool-output: #1a1a1a; --se-thinking-text: #5c5c5c; --se-custom-msg-bg: #f2f2f2; --se-custom-msg-text: #1a1a1a; --se-syn-comment: #808080; --se-syn-keyword: #8b5cf6; --se-syn-number: #d97706; --se-syn-string: #22c55e; --se-syn-function: #3b82f6; --se-syn-type: #d97706; --se-syn-variable: #1a1a1a; --se-syn-operator: #ef4444; --se-syn-punctuation: #5c5c5c; }
}
body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: var(--se-line-height); color: var(--se-text); background: var(--se-body-bg); }
body.sidebar-resizing { cursor: col-resize; user-select: none; }
#app { display: flex; min-height: 100vh; }
#sidebar { width: var(--se-sidebar-width); min-width: var(--se-sidebar-width); max-width: var(--se-sidebar-width); background: var(--se-container-bg); flex-shrink: 0; display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; border-right: 1px solid var(--se-dim); }
#sidebar-resizer { width: var(--se-sidebar-resizer-width); flex-shrink: 0; position: sticky; top: 0; height: 100vh; cursor: col-resize; touch-action: none; background: transparent; border-right: 1px solid transparent; }
#sidebar-resizer:hover, body.sidebar-resizing #sidebar-resizer { background: var(--se-selected-bg); border-right-color: var(--se-dim); }
.sidebar-header { padding: 8px 12px; flex-shrink: 0; }
.sidebar-controls { padding: 8px 8px 4px 8px; }
.sidebar-search { width: 100%; box-sizing: border-box; padding: 4px 8px; font-size: 11px; font-family: inherit; background: var(--se-body-bg); color: var(--se-text); border: 1px solid var(--se-dim); border-radius: 4px; }
.sidebar-search:focus { outline: none; border-color: var(--se-border-accent); }
.sidebar-search::placeholder { color: var(--se-muted); }
.sidebar-filters { display: flex; padding: 4px 8px 8px 8px; gap: 4px; align-items: center; flex-wrap: wrap; }
.filter-btn { padding: 3px 8px; font-size: 10px; font-family: inherit; background: transparent; color: var(--se-muted); border: 1px solid var(--se-dim); border-radius: 3px; cursor: pointer; }
.filter-btn:hover { color: var(--se-text); border-color: var(--se-text); }
.filter-btn.active { background: var(--se-accent); color: var(--se-body-bg); border-color: var(--se-accent); }
.sidebar-close { display: none; padding: 3px 8px; font-size: 12px; font-family: inherit; background: transparent; color: var(--se-muted); border: 1px solid var(--se-dim); border-radius: 3px; cursor: pointer; margin-left: auto; }
.sidebar-close:hover { color: var(--se-text); border-color: var(--se-text); }
.tree-container { flex: 1; overflow: auto; padding: 4px 0; }
.tree-node { padding: 0 8px; cursor: pointer; display: flex; align-items: baseline; font-size: 11px; line-height: 13px; white-space: nowrap; }
.tree-node:hover { background: var(--se-selected-bg); }
.tree-node.active { background: var(--se-selected-bg); }
.tree-node.active .tree-content { font-weight: bold; }
.tree-node.in-path { background: color-mix(in srgb, var(--se-accent) 10%, transparent); }
.tree-node:not(.in-path) { opacity: 0.5; }
.tree-node:not(.in-path):hover { opacity: 1; }
.tree-prefix { color: var(--se-muted); flex-shrink: 0; font-family: monospace; white-space: pre; }
.tree-marker { color: var(--se-accent); flex-shrink: 0; }
.tree-content { color: var(--se-text); }
.tree-role-user { color: var(--se-accent); }
.tree-role-assistant { color: var(--se-success); }
.tree-role-tool { color: var(--se-muted); }
.tree-role-system { color: var(--se-warning); }
.tree-muted { color: var(--se-muted); }
.tree-error { color: var(--se-error); }
.tree-status { padding: 4px 12px; font-size: 10px; color: var(--se-muted); flex-shrink: 0; }
#content { flex: 1; min-width: 0; overflow-y: auto; padding: var(--se-line-height) calc(var(--se-line-height) * 2); display: flex; flex-direction: column; align-items: center; }
#content > * { width: 100%; max-width: 800px; }
.help-bar { font-size: 11px; color: var(--se-warning); margin-bottom: var(--se-line-height); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.help-hint { flex: 1 1 240px; }
.help-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.header-toggle-btn, .download-json-btn { font-size: 10px; padding: 2px 8px; background: var(--se-container-bg); border: 1px solid var(--se-border); border-radius: 3px; color: var(--se-text); cursor: pointer; font-family: inherit; }
.header-toggle-btn:hover, .download-json-btn:hover { background: var(--se-hover); border-color: var(--se-border-accent); }
.header { background: var(--se-container-bg); border-radius: 4px; padding: var(--se-line-height); margin-bottom: var(--se-line-height); }
.header h1 { font-size: 12px; font-weight: bold; color: var(--se-border-accent); margin-bottom: var(--se-line-height); }
.header-info { display: flex; flex-direction: column; gap: 0; font-size: 11px; }
.info-item { color: var(--se-dim); display: flex; align-items: baseline; }
.info-label { font-weight: 600; margin-right: 8px; min-width: 100px; }
.info-value { color: var(--se-text); flex: 1; }
#messages { display: flex; flex-direction: column; gap: var(--se-line-height); }
.message-timestamp { font-size: 10px; color: var(--se-dim); opacity: 0.8; }
.user-message { background: var(--se-user-msg-bg); color: var(--se-user-msg-text); padding: var(--se-line-height); border-radius: 4px; position: relative; }
.assistant-message { padding: 0; position: relative; }
.copy-link-btn { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; padding: 6px; background: var(--se-container-bg); border: 1px solid var(--se-dim); border-radius: 4px; color: var(--se-muted); cursor: pointer; opacity: 0; transition: opacity 0.15s; display: flex; align-items: center; justify-content: center; z-index: 10; }
.user-message:hover .copy-link-btn, .assistant-message:hover .copy-link-btn { opacity: 1; }
.copy-link-btn:hover { background: var(--se-accent); color: var(--se-body-bg); border-color: var(--se-accent); }
.copy-link-btn.copied { background: var(--se-success); color: white; border-color: var(--se-success); }
.user-message.highlight, .assistant-message.highlight { animation: highlight-pulse 2s ease-out; }
@keyframes highlight-pulse { 0% { box-shadow: 0 0 0 3px var(--se-accent); } 100% { box-shadow: 0 0 0 0 transparent; } }
.assistant-message > .message-timestamp { padding-left: var(--se-line-height); }
.assistant-text { padding: var(--se-line-height); padding-bottom: 0; }
.message-timestamp + .assistant-text, .message-timestamp + .thinking-block { padding-top: 0; }
.thinking-block + .assistant-text { padding-top: 0; }
.thinking-text { padding: var(--se-line-height); color: var(--se-thinking-text); font-style: italic; white-space: pre-wrap; }
.thinking-collapsed { display: none; padding: var(--se-line-height); color: var(--se-thinking-text); font-style: italic; }
.tool-execution { padding: var(--se-line-height); border-radius: 4px; }
.tool-execution + .tool-execution { margin-top: var(--se-line-height); }
.assistant-text + .tool-execution { margin-top: var(--se-line-height); }
.tool-execution.pending { background: var(--se-tool-pending-bg); }
.tool-execution.success { background: var(--se-tool-success-bg); }
.tool-execution.error { background: var(--se-tool-error-bg); }
.tool-header, .tool-name { font-weight: bold; }
.tool-path { color: var(--se-accent); word-break: break-all; }
.line-numbers { color: var(--se-warning); }
.line-count { color: var(--se-muted); }
.tool-command { font-weight: bold; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; word-break: break-word; }
.tool-output { margin-top: var(--se-line-height); color: var(--se-tool-output); word-wrap: break-word; overflow-wrap: break-word; font-family: inherit; overflow-x: auto; }
.tool-output > div, .output-preview > div, .output-full > div { margin: 0; padding: 0; line-height: var(--se-line-height); }
.tool-output > div:not(.output-preview):not(.output-full), .output-preview > div:not(.expand-hint), .output-full > div:not(.expand-hint) { white-space: pre-wrap; }
.tool-output pre { margin: 0; padding: 0; font-family: inherit; color: inherit; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; }
.tool-output code { padding: 0; background: none; color: var(--se-text); }
.tool-output.expandable { cursor: pointer; }
.tool-output.expandable .output-full { display: none; }
.tool-output.expandable.expanded .output-preview { display: none; }
.tool-output.expandable.expanded .output-full { display: block; }
.tool-images { margin: var(--se-line-height) 0; }
.tool-image { max-width: 100%; max-height: 500px; border-radius: 4px; }
.expand-hint { color: var(--se-tool-output); }
.tool-diff { font-size: 11px; overflow-x: auto; white-space: pre; }
.diff-added { color: var(--se-diff-added); }
.diff-removed { color: var(--se-diff-removed); }
.diff-context { color: var(--se-diff-context); }
.model-change { padding: 0 var(--se-line-height); color: var(--se-muted); font-size: 11px; }
.model-name { color: var(--se-border-accent); font-weight: bold; }
.system-prompt { background: var(--se-custom-msg-bg); padding: var(--se-line-height); border-radius: 4px; margin-bottom: var(--se-line-height); }
.system-prompt.expandable { cursor: pointer; }
.system-prompt-header { font-weight: bold; color: var(--se-custom-msg-label); }
.system-prompt-preview { color: var(--se-custom-msg-text); white-space: pre-wrap; word-wrap: break-word; font-size: 11px; margin-top: var(--se-line-height); }
.system-prompt-expand-hint { color: var(--se-muted); font-style: italic; margin-top: 4px; }
.system-prompt-full { display: none; color: var(--se-custom-msg-text); white-space: pre-wrap; word-wrap: break-word; font-size: 11px; margin-top: var(--se-line-height); }
.system-prompt.expanded .system-prompt-preview, .system-prompt.expanded .system-prompt-expand-hint { display: none; }
.system-prompt.expanded .system-prompt-full { display: block; }
.tools-list { background: var(--se-custom-msg-bg); padding: var(--se-line-height); border-radius: 4px; margin-bottom: var(--se-line-height); }
.tools-header { font-weight: bold; color: var(--se-custom-msg-label); margin-bottom: var(--se-line-height); }
.tool-item { font-size: 11px; }
.tool-item-name { font-weight: bold; color: var(--se-text); }
.tool-item-desc { color: var(--se-dim); }
.tool-params-hint { color: var(--se-muted); font-style: italic; }
.tool-item:has(.tool-params-hint) { cursor: pointer; }
.tool-params-hint::after { content: '[click to show parameters]'; }
.tool-item.params-expanded .tool-params-hint::after { content: '[hide parameters]'; }
.tool-params-content { display: none; margin-top: 4px; margin-left: 12px; padding-left: 8px; border-left: 1px solid var(--se-dim); }
.tool-item.params-expanded .tool-params-content { display: block; }
.tool-param { margin-bottom: 4px; font-size: 11px; }
.tool-param-name { font-weight: bold; color: var(--se-text); }
.tool-param-type { color: var(--se-dim); font-style: italic; }
.tool-param-required { color: var(--se-warning); font-size: 10px; }
.tool-param-optional { color: var(--se-dim); font-size: 10px; }
.tool-param-desc { color: var(--se-dim); margin-left: 8px; }
.error-text { color: var(--se-error); padding: 0 var(--se-line-height); }
.tool-error { color: var(--se-error); }
.message-images { margin-bottom: 12px; }
.message-image { max-width: 100%; max-height: 400px; border-radius: 4px; margin: var(--se-line-height) 0; }
.markdown-content h1, .markdown-content h2, .markdown-content h3, .markdown-content h4, .markdown-content h5, .markdown-content h6 { color: var(--se-md-heading); margin: var(--se-line-height) 0 0 0; font-weight: bold; }
.markdown-content h1 { font-size: 1em; } .markdown-content h2 { font-size: 1em; } .markdown-content h3 { font-size: 1em; }
.markdown-content p { margin: 0; } .markdown-content p + p { margin-top: var(--se-line-height); }
.markdown-content a { color: var(--se-md-link); text-decoration: underline; }
.markdown-content code { background: rgba(128,128,128,0.2); color: var(--se-md-code); padding: 0 4px; border-radius: 3px; font-family: inherit; }
.markdown-content pre { background: transparent; margin: var(--se-line-height) 0; overflow-x: auto; }
.markdown-content pre code { display: block; background: none; color: var(--se-text); }
.markdown-content blockquote { border-left: 3px solid var(--se-md-quote-border); padding-left: var(--se-line-height); margin: var(--se-line-height) 0; color: var(--se-md-quote); font-style: italic; }
.markdown-content ul, .markdown-content ol { margin: var(--se-line-height) 0; padding-left: calc(var(--se-line-height) * 2); }
.markdown-content li { margin: 0; } .markdown-content li::marker { color: var(--se-md-list-bullet); }
.markdown-content hr { border: none; border-top: 1px solid var(--se-md-hr); margin: var(--se-line-height) 0; }
.markdown-content table { border-collapse: collapse; margin: 0.5em 0; width: 100%; }
.markdown-content th, .markdown-content td { border: 1px solid var(--se-md-code-block-border); padding: 6px 10px; text-align: left; }
.markdown-content th { background: rgba(128,128,128,0.1); font-weight: bold; }
.markdown-content img { max-width: 100%; border-radius: 4px; }
.hljs { background: transparent; color: var(--se-text); }
.hljs-comment, .hljs-quote { color: var(--se-syn-comment); }
.hljs-keyword, .hljs-selector-tag { color: var(--se-syn-keyword); }
.hljs-number, .hljs-literal { color: var(--se-syn-number); }
.hljs-string, .hljs-doctag { color: var(--se-syn-string); }
.hljs-function, .hljs-title, .hljs-title.function_, .hljs-section, .hljs-name { color: var(--se-syn-function); }
.hljs-type, .hljs-class, .hljs-title.class_, .hljs-built_in { color: var(--se-syn-type); }
.hljs-attr, .hljs-variable, .hljs-variable.language_, .hljs-params, .hljs-property { color: var(--se-syn-variable); }
.hljs-meta, .hljs-meta .hljs-keyword, .hljs-meta .hljs-string { color: var(--se-syn-keyword); }
.hljs-operator { color: var(--se-syn-operator); }
.hljs-punctuation { color: var(--se-syn-punctuation); }
.hljs-subst { color: var(--se-text); }
.footer { margin-top: 48px; padding: 20px; text-align: center; color: var(--se-dim); font-size: 10px; }
#hamburger { display: none; position: fixed; top: 10px; left: 10px; z-index: 100; padding: 3px 8px; font-size: 12px; font-family: inherit; background: transparent; color: var(--se-muted); border: 1px solid var(--se-dim); border-radius: 3px; cursor: pointer; }
#hamburger:hover { color: var(--se-text); border-color: var(--se-text); }
#sidebar-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 98; }
@media (max-width: 900px) {
  #sidebar { position: fixed; left: 0; width: min(var(--se-sidebar-width), 100vw); min-width: min(var(--se-sidebar-width), 100vw); max-width: min(var(--se-sidebar-width), 100vw); top: 0; bottom: 0; height: 100vh; z-index: 99; transform: translateX(-100%); transition: transform 0.3s; }
  #sidebar.open { transform: translateX(0); }
  #sidebar-resizer { display: none; }
  #sidebar-overlay.open { display: block; }
  #hamburger { display: block; }
  .sidebar-close { display: block; }
  #content { padding: var(--se-line-height) 16px; }
  #content > * { max-width: 100%; }
}
@media print { #sidebar, #sidebar-resizer { display: none !important; } body { background: white; color: black; } #content { max-width: none; } }
`

// ─── JavaScript Template (适配 Maximilian 类型) ──────────────────────────

const JS_TEMPLATE = `
(function() {
  'use strict';

  const SESSION_DATA = '{{SESSION_DATA}}';
  let data;
  try {
    data = JSON.parse(SESSION_DATA);
  } catch (e) {
    document.body.innerHTML = '<div style="padding:20px;color:red">Invalid session data.</div>';
    throw e;
  }
  if (!data || !Array.isArray(data.messages)) {
    document.body.innerHTML = '<div style="padding:20px;color:red">Session data is malformed.</div>';
    throw new Error('session-export: messages must be an array');
  }
  const { messages, sessionId, provider, model, createdAt } = data;

  // URL 参数处理
  const searchString = document.location.search.substring(1);
  const urlParams = new URLSearchParams(searchString);
  const urlLeafId = urlParams.get('leafId');
  const urlTargetId = urlParams.get('targetId');

  // Entry 映射 (每个 Message 作为一个 entry)
  const entries = messages.map((msg, i) => ({
    id: msg.id || \`msg-\${i}\`,
    type: 'message',
    parentId: null,
    timestamp: msg.timestamp || createdAt || Date.now(),
    message: msg,
  }));

  const byId = new Map();
  for (const e of entries) byId.set(e.id, e);

  // Tool call map
  const toolCallMap = new Map();
  for (const e of entries) {
    if (e.message.role === 'assistant') {
      for (const block of (e.message.content || [])) {
        if (block.type === 'tool-call') {
          toolCallMap.set(block.id, { name: block.name, arguments: block.arguments });
        }
      }
    }
  }

  // Tool result map
  const toolResultMap = new Map();
  for (const e of entries) {
    if (e.message.role === 'user' && e.message.source?.kind === 'tool') {
      const toolCallId = e.message.source?.callId;
      if (toolCallId) toolResultMap.set(toolCallId, e.message);
    }
  }

  // 校验深链接 ID 是否存在于 entries 中
  function resolveLeafId(id) {
    if (id && byId.has(id)) return id;
    return null;
  }

  const validLeafId = resolveLeafId(urlLeafId);
  const validTargetId = urlTargetId && byId.has(urlTargetId) ? urlTargetId : null;

  // ── Tree ──
  function buildTree() {
    const roots = [...entries];
    return roots;
  }

  function buildActivePathIds(targetId) {
    const ids = new Set();
    let current = byId.get(targetId);
    while (current) {
      ids.add(current.id);
      if (!current.parentId || current.parentId === current.id) break;
      current = byId.get(current.parentId);
    }
    return ids;
  }

  function getPath(targetId) {
    const path = [];
    let current = byId.get(targetId);
    while (current) {
      path.unshift(current);
      if (!current.parentId || current.parentId === current.id) break;
      current = byId.get(current.parentId);
    }
    return path;
  }

  let filterMode = 'default';
  let searchQuery = '';

  function extractContent(content) {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.filter(c => c.type === 'text' && c.text).map(c => c.text).join('');
    }
    return '';
  }

  function hasTextContent(content) {
    if (typeof content === 'string') return content.trim().length > 0;
    if (Array.isArray(content)) return content.some(c => c.type === 'text' && c.text?.trim());
    return false;
  }

  function flattenTree(roots, activePathIds) {
    const result = [];
    for (const entry of roots) {
      result.push({
        node: { entry, children: [], label: undefined },
        indent: 0,
        showConnector: false,
        isLast: true,
        gutters: [],
        isVirtualRootChild: false,
        multipleRoots: false,
      });
    }
    return result;
  }

  function buildTreePrefix(flatNode) {
    const { indent, showConnector, isLast, gutters, isVirtualRootChild, multipleRoots } = flatNode;
    if (!showConnector || isVirtualRootChild) return '';
    const displayIndent = multipleRoots ? Math.max(0, indent - 1) : indent;
    let prefix = '';
    for (let i = 0; i < displayIndent; i++) {
      const gutter = gutters.find(g => g.position === i);
      prefix += (gutter && !gutter.show) ? '  ' : '│ ';
    }
    prefix += isLast ? '└─ ' : '├─ ';
    return prefix;
  }

  function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function truncate(s, maxLen = 100) {
    if (!s || s.length <= maxLen) return s || '';
    return s.slice(0, maxLen) + '...';
  }

  function getTreeNodeDisplayHtml(entry, label) {
    const msg = entry.message;
    const labelHtml = label ? \`<span class="tree-label">[\${escapeHtml(label)}]</span> \` : '';
    if (msg.role === 'user') {
      const text = truncate(extractContent(msg.content));
      return labelHtml + \`<span class="tree-role-user">user:</span> \${escapeHtml(text)}\`;
    }
    if (msg.role === 'assistant') {
      const text = truncate(extractContent(msg.content));
      if (text) return labelHtml + \`<span class="tree-role-assistant">assistant:</span> \${escapeHtml(text)}\`;
      const hasThinking = (msg.content || []).some(c => c.type === 'reasoning');
      if (hasThinking) return labelHtml + \`<span class="tree-role-assistant">assistant:</span> <span class="tree-muted">(thinking)</span>\`;
      return labelHtml + \`<span class="tree-role-assistant">assistant:</span> <span class="tree-muted">(no text)</span>\`;
    }
    if (msg.role === 'system') {
      return labelHtml + \`<span class="tree-role-system">system:</span> \${escapeHtml(truncate(extractContent(msg.content)))}\`;
    }
    return labelHtml + \`<span class="tree-muted">[\${escapeHtml(msg.role)}]</span>\`;
  }

  let currentLeafId = validLeafId || (entries.length > 0 ? entries[entries.length - 1].id : null);
  let currentTargetId = validTargetId || currentLeafId;

  function renderTree() {
    const tree = buildTree();
    const activePathIds = buildActivePathIds(currentLeafId);
    const flatNodes = flattenTree(tree, activePathIds);
    const filtered = flatNodes; // 简化: 不过滤
    const container = document.getElementById('tree-container');
    container.innerHTML = '';

    for (const flatNode of filtered) {
      const entry = flatNode.node.entry;
      const isOnPath = activePathIds.has(entry.id);
      const isTarget = entry.id === currentTargetId;

      const div = document.createElement('div');
      div.className = 'tree-node' + (isOnPath ? ' in-path' : '') + (isTarget ? ' active' : '');
      div.dataset.id = entry.id;

      const prefixSpan = document.createElement('span');
      prefixSpan.className = 'tree-prefix';
      prefixSpan.textContent = buildTreePrefix(flatNode);

      const marker = document.createElement('span');
      marker.className = 'tree-marker';
      marker.textContent = isOnPath ? '•' : ' ';

      const content = document.createElement('span');
      content.className = 'tree-content';
      content.innerHTML = getTreeNodeDisplayHtml(entry, flatNode.node.label);

      div.appendChild(prefixSpan);
      div.appendChild(marker);
      div.appendChild(content);
      div.addEventListener('click', () => {
        if (window.getSelection().toString()) return;
        navigateTo(entry.id, 'target', entry.id);
      });
      container.appendChild(div);
    }

    document.getElementById('tree-status').textContent = \`\${filtered.length} entries\`;
  }

  function formatTimestamp(ts) {
    if (!ts) return '';
    const date = new Date(ts);
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function formatExpandableOutput(text, maxLines) {
    if (!text) return '';
    const lines = text.split('\\n');
    const displayLines = lines.slice(0, maxLines);
    const remaining = lines.length - maxLines;

    if (remaining > 0) {
      const preview = escapeHtml(displayLines.join('\\n'));
      const full = escapeHtml(lines.join('\\n'));
      return \`<div class="tool-output expandable" onclick="if(window.getSelection().toString())return;this.classList.toggle('expanded')">
        <div class="output-preview"><pre><code>\${preview}</code></pre><div class="expand-hint">... (\${remaining} more lines)</div></div>
        <div class="output-full"><pre><code>\${full}</code></pre></div></div>\`;
    }
    return \`<div class="tool-output"><pre><code>\${escapeHtml(text)}</code></pre></div>\`;
  }

  function renderToolCall(call) {
    const result = toolResultMap.get(call.id);
    const isError = result?.isError;
    const statusClass = result ? (isError ? 'error' : 'success') : 'pending';
    const toolDomId = \`tool-call-\${escapeHtml(call.id)}\`;

    let html = \`<div class="tool-execution \${statusClass}" id="\${toolDomId}">\`;
    html += \`<div class="tool-header"><span class="tool-name">\${escapeHtml(call.name)}</span></div>\`;

    // Arguments
    if (call.arguments) {
      let parsedArgs = null;
      try {
        parsedArgs = JSON.parse(call.arguments);
      } catch {
        // malformed JSON — fall through to raw display
      }
      if (parsedArgs !== null) {
        html += formatExpandableOutput(JSON.stringify(parsedArgs, null, 2), 10);
      } else {
        html += formatExpandableOutput(call.arguments, 10);
      }
    }

    // Result
    if (result && result.content) {
      for (const block of result.content) {
        if (block.type === 'text' && block.text) {
          html += \`<div class="tool-output"><pre><code>\${escapeHtml(block.text)}</code></pre></div>\`;
        }
        if (block.type === 'image') {
          html += \`<div class="tool-images"><img src="data:\${escapeHtml(block.mediaType || 'image/png')};base64,\${escapeHtml(block.data)}" class="tool-image" /></div>\`;
        }
      }
    }

    html += '</div>';
    return html;
  }

  function renderEntry(entry) {
    const msg = entry.message;
    const ts = formatTimestamp(entry.timestamp);
    const tsHtml = ts ? \`<div class="message-timestamp">\${ts}</div>\` : '';
    const entryDomId = \`entry-\${escapeHtml(entry.id)}\`;

    if (msg.role === 'user') {
      let html = \`<div class="user-message" id="\${entryDomId}">\${tsHtml}\`;
      const content = msg.content || [];
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          html += \`<div class="markdown-content">\${escapeHtml(block.text)}</div>\`; // 简化: 不用 marked
        }
        if (block.type === 'image') {
          html += \`<div class="message-images"><img src="data:\${escapeHtml(block.mediaType || 'image/png')};base64,\${escapeHtml(block.data)}" class="message-image" /></div>\`;
        }
      }
      html += '</div>';
      return html;
    }

    if (msg.role === 'assistant') {
      let html = \`<div class="assistant-message" id="\${entryDomId}">\${tsHtml}\`;
      const content = msg.content || [];
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          html += \`<div class="assistant-text markdown-content">\${escapeHtml(block.text)}</div>\`;
        }
        if (block.type === 'reasoning' && block.text) {
          html += \`<div class="thinking-block">
            <div class="thinking-text">\${escapeHtml(block.text)}</div>
            <div class="thinking-collapsed">Thinking ...</div>
          </div>\`;
        }
      }
      for (const block of content) {
        if (block.type === 'tool-call') {
          html += renderToolCall(block);
        }
      }
      html += '</div>';
      return html;
    }

    if (msg.role === 'system') {
      return \`<div class="system-prompt expandable" id="\${entryDomId}" onclick="if(window.getSelection().toString())return;this.classList.toggle('expanded')">
        \${tsHtml}
        <div class="system-prompt-header">System Prompt</div>
        <div class="system-prompt-preview">\${escapeHtml(truncate(extractContent(msg.content), 200))}</div>
        <div class="system-prompt-expand-hint">(click to expand)</div>
        <div class="system-prompt-full">\${escapeHtml(extractContent(msg.content))}</div>
      </div>\`;
    }

    return '';
  }

  function computeStats() {
    let user = 0, assistant = 0, toolCalls = 0;
    for (const e of entries) {
      if (e.message.role === 'user') user++;
      if (e.message.role === 'assistant') {
        assistant++;
        toolCalls += (e.message.content || []).filter(c => c.type === 'tool-call').length;
      }
    }
    return { user, assistant, toolCalls };
  }

  function renderHeader() {
    const stats = computeStats();
    const tokenParts = [];
    const msgParts = [];
    if (stats.user) msgParts.push(\`\${stats.user} user\`);
    if (stats.assistant) msgParts.push(\`\${stats.assistant} assistant\`);
    if (stats.toolCalls) msgParts.push(\`\${stats.toolCalls} tool calls\`);

    return \`
      <div class="header">
        <h1>Session: \${escapeHtml(sessionId || 'unknown')}</h1>
        <div class="help-bar">
          <span class="help-hint">T toggle thinking · O toggle tools</span>
        </div>
        <div class="header-info">
          <div class="info-item"><span class="info-label">Date:</span><span class="info-value">\${createdAt ? new Date(createdAt).toLocaleString() : 'unknown'}</span></div>
          <div class="info-item"><span class="info-label">Model:</span><span class="info-value">\${escapeHtml(provider || '')}/\${escapeHtml(model || '')}</span></div>
          <div class="info-item"><span class="info-label">Messages:</span><span class="info-value">\${msgParts.join(', ') || '0'}</span></div>
        </div>
      </div>\`;
  }

  function navigateTo(targetId, scrollMode, scrollToEntryId) {
    currentLeafId = targetId;
    currentTargetId = scrollToEntryId || targetId;
    renderTree();
    document.getElementById('header-container').innerHTML = renderHeader();

    const path = getPath(targetId);
    const messagesEl = document.getElementById('messages');
    messagesEl.innerHTML = '';

    for (const entry of path) {
      const html = renderEntry(entry);
      if (html) {
        const template = document.createElement('template');
        template.innerHTML = html;
        messagesEl.appendChild(template.content.firstElementChild);
      }
    }

    setTimeout(() => {
      const content = document.getElementById('content');
      if (scrollMode === 'bottom') {
        content.scrollTop = content.scrollHeight;
      } else if (scrollMode === 'target' && scrollToEntryId) {
        const el = document.getElementById(\`entry-\${scrollToEntryId}\`) || document.getElementById(scrollToEntryId);
        if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('highlight'); setTimeout(() => el.classList.remove('highlight'), 2000); }
      }
    }, 0);
  }

  // Toggle
  let thinkingExpanded = true;
  let toolOutputsExpanded = false;
  const toggleThinking = () => {
    thinkingExpanded = !thinkingExpanded;
    document.querySelectorAll('.thinking-text').forEach(el => { el.style.display = thinkingExpanded ? '' : 'none'; });
    document.querySelectorAll('.thinking-collapsed').forEach(el => { el.style.display = thinkingExpanded ? 'none' : 'block'; });
  };
  const toggleToolOutputs = () => {
    toolOutputsExpanded = !toolOutputsExpanded;
    document.querySelectorAll('.tool-output.expandable, .system-prompt.expandable').forEach(el => {
      if (toolOutputsExpanded) el.classList.add('expanded'); else el.classList.remove('expanded');
    });
  };
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 't') { e.preventDefault(); toggleThinking(); }
    if (e.key === 'o') { e.preventDefault(); toggleToolOutputs(); }
  });

  // Mobile sidebar
  const hamburger = document.getElementById('hamburger');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  hamburger?.addEventListener('click', () => { sidebar.classList.add('open'); overlay.classList.add('open'); hamburger.style.display = 'none'; });
  overlay?.addEventListener('click', () => { sidebar.classList.remove('open'); overlay.classList.remove('open'); hamburger.style.display = ''; });
  document.getElementById('sidebar-close')?.addEventListener('click', () => { sidebar.classList.remove('open'); overlay.classList.remove('open'); hamburger.style.display = ''; });

  // Resize
  const SIDEBAR_WIDTH_STORAGE_KEY = 'max-session-export:v1:sidebar-width';
  const sidebarResizer = document.getElementById('sidebar-resizer');
  if (sidebarResizer) {
    let startX, startWidth;
    sidebarResizer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = sidebar.getBoundingClientRect().width;
      document.body.classList.add('sidebar-resizing');
      const onMove = (ev) => {
        const w = startWidth + (ev.clientX - startX);
        const clamped = Math.max(240, Math.min(840, w));
        document.documentElement.style.setProperty('--se-sidebar-width', clamped + 'px');
      };
      const onUp = () => {
        document.body.classList.remove('sidebar-resizing');
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        try { localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, sidebar.getBoundingClientRect().width); } catch {}
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
    sidebarResizer.addEventListener('dblclick', () => {
      document.documentElement.style.setProperty('--se-sidebar-width', '400px');
      try { localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY); } catch {}
    });
  }

  // Initial render
  if (currentLeafId) navigateTo(currentLeafId, validTargetId ? 'target' : 'none', validTargetId);
  else if (entries.length > 0) navigateTo(entries[entries.length - 1].id, 'none');
})();
`

// ─── Public API ─────────────────────────────────────────────────────────

export interface ExportSessionOptions {
  /** 会话 ID */
  sessionId: string
  /** 消息列表 */
  messages: Message[]
  /** 模型提供商 */
  provider?: string
  /** 模型名称 */
  model?: string
  /** 创建时间 (ms) */
  createdAt?: number
}

/**
 * 将 Maximilian 会话数据导出为自包含 HTML 字符串。
 *
 * 生成一个独立的 HTML 文件，包含：
 * - 内嵌的 CSS 样式（适配深色/浅色主题）
 * - 内嵌的 JavaScript（树形导航、Markdown 渲染、折叠等交互）
 * - 会话数据（JSON 内联，不依赖外部资源）
 *
 * 使用方式：
 * ```ts
 * import { exportSessionToHtml } from '@max/core'
 * const html = exportSessionToHtml({ sessionId: 's123', messages: [...], provider: 'openai', model: 'gpt-4' })
 * Bun.write('session.html', html)
 * ```
 */
export function exportSessionToHtml(options: ExportSessionOptions): string {
  const { sessionId, messages, provider, model, createdAt } = options

  const sessionData = JSON.stringify({
    sessionId,
    messages: messages.map((msg) => {
      // 剥离 provider/model 等内部实现细节，只保留必要字段
      let source
      if (msg.source?.kind === "model") {
        source = { kind: "model" }
      } else if (msg.source?.kind === "tool") {
        source = { kind: "tool", callId: msg.source.callId }
      } else if (msg.source) {
        source = { kind: msg.source.kind }
      } else {
        source = { kind: "user" }
      }
      return {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        source,
        timestamp: createdAt ?? Date.now(),
      }
    }),
    provider,
    model,
    createdAt,
  })

  const jsWithData = JS_TEMPLATE.replace("{{SESSION_DATA}}", sessionData)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Session: ${escapeHtml(sessionId)}</title>
  <style>
${CSS_TEMPLATE}
  </style>
</head>
<body>
  <button id="hamburger" title="Open sidebar">☰</button>
  <div id="sidebar-overlay"></div>
  <div id="app">
    <aside id="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-controls">
          <input type="text" class="sidebar-search" id="tree-search" placeholder="Search..." disabled>
        </div>
        <div class="sidebar-filters">
          <button class="filter-btn active" data-filter="default">Default</button>
          <button class="filter-btn" data-filter="no-tools">No-tools</button>
          <button class="filter-btn" data-filter="user-only">User</button>
          <button class="filter-btn" data-filter="all">All</button>
          <button class="sidebar-close" id="sidebar-close" title="Close">✕</button>
        </div>
      </div>
      <div class="tree-container" id="tree-container"></div>
      <div class="tree-status" id="tree-status"></div>
    </aside>
    <div id="sidebar-resizer" role="separator" aria-orientation="vertical"></div>
    <main id="content">
      <div id="header-container"></div>
      <div id="messages"></div>
    </main>
  </div>
  <script>
${jsWithData}
  </script>
</body>
</html>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
