// 项目详情脚本 / Project Script
import { API_BASE, fetchJSON } from "/globals/global.js";

const detail = document.getElementById("projectDetail");

function getProjectId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function render(project) {
  detail.innerHTML = `
    <div class="tag">项目详情</div>
    <h2>${project.name}</h2>
    <p class="notice">${project.summary || ""}</p>
    ${project.cover_url ? `<img src="${project.cover_url}" alt="${project.name}" style="width:100%; border-radius:16px; margin-top:16px;"/>` : ""}
    <div style="margin-top: 18px; line-height: 1.7; color: #4a453d;">
      ${project.content_html || "暂无详细介绍。"}
    </div>
    ${project.external_url ? `<a class="btn" style="margin-top:16px;" href="${project.external_url}" target="_blank">访问项目</a>` : ""}
  `;
}

async function load() {
  const id = getProjectId();
  if (!id) {
    detail.innerHTML = "缺少项目 ID。";
    return;
  }
  try {
    const project = await fetchJSON(`${API_BASE}/projects/${id}`);
    render(project);
  } catch (err) {
    detail.innerHTML = `加载失败：${err.message}`;
  }
}

load();