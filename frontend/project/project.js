// 项目详情脚本 / Project Script
import { API_BASE, fetchJSON, escapeHTML } from "/globals/global.js";

const detail = document.getElementById("projectDetail");

function splitTags(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getProjectId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return new Date(dateString).toLocaleDateString('zh-CN', options);
}

function render(project) {
  const safeName = escapeHTML(project.name || "");
  const safeSummary = escapeHTML(project.summary || "");
  const tags = splitTags(project.tags).map(escapeHTML);
  const tagsHtml = tags.length
    ? `<div class="tag-list flex justify-center mt-3">${tags.map((tag) => `<span class="tag-chip">${tag}</span>`).join("")}</div>`
    : "";

  let visualHtml = "";
  if (project.video_url) {
    visualHtml = `
      <div class="project-visuals">
        <video class="project-video" controls poster="${project.cover_url || ''}">
          <source src="${project.video_url}" type="video/mp4">
          您的浏览器不支持视频播放。
        </video>
      </div>
    `;
  } else if (project.cover_url) {
    visualHtml = `
      <div class="project-visuals">
        <img src="${project.cover_url}" alt="${safeName}" class="project-image" />
      </div>
    `;
  }

  detail.innerHTML = `
    <div class="project-header">
      <h1 class="project-title">${safeName}</h1>
      <div class="project-summary-box">${safeSummary}</div>
      ${tagsHtml}
      <div class="mt-4 text-muted" style="font-size: 0.85rem; letter-spacing: 0.05em;">
        浏览次数 ${project.view_count || 0} / 发布日期 ${formatDate(project.created_at)}
      </div>
    </div>

    ${visualHtml}

    <div class="project-content">
      ${project.content_html || "<p class='text-center text-muted'>暂无详细介绍信息。</p>"}
    </div>
    
    <div class="project-actions">
      ${project.external_url ? `<a class="btn primary" href="${project.external_url}" target="_blank">访问在线产品</a>` : ""}
      <a href="/" class="btn">返回作品列表</a>
    </div>
  `;
}

async function load() {
  const id = getProjectId();
  if (!id) {
    detail.innerHTML = "<div class='text-center'>缺少项目 ID。</div>";
    return;
  }
  try {
    const project = await fetchJSON(`${API_BASE}/projects/${id}`);
    render(project);
    document.title = `${project.name} - JEJE WEB`;
  } catch (err) {
    detail.innerHTML = `<div class='text-center text-error'>加载项目失败：${err.message}</div>`;
  }
}

load();
