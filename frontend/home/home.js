// 首页脚本 / Home Script
import { API_BASE, fetchJSON, formatDate } from "/globals/global.js";

const grid = document.getElementById("projectGrid");

function projectCard(project) {
  const card = document.createElement("a");
  card.className = "card";
  card.href = `/project?id=${project.id}`;

  card.innerHTML = `
    <div class="tag">项目</div>
    <div class="title">${project.name}</div>
    <div class="summary">${project.summary || "暂无简介"}</div>
    <div class="meta">
      <span>${project.external_url ? "可访问" : "展示"}</span>
      <span>${formatDate(project.created_at)}</span>
    </div>
  `;
  return card;
}

async function loadProjects() {
  try {
    const data = await fetchJSON(`${API_BASE}/projects`);
    const list = data.data || [];
    grid.innerHTML = "";
    if (!list.length) {
      grid.innerHTML = `<div class="card">暂无项目，请稍后添加。</div>`;
      return;
    }
    list.forEach((project) => grid.appendChild(projectCard(project)));
  } catch (err) {
    grid.innerHTML = `<div class="card">加载失败：${err.message}</div>`;
  }
}


// 实现平滑滚动并保持 URL 简洁 / Smooth Scroll & Clean URL
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const targetId = this.getAttribute('href').substring(1);
    const targetElement = document.getElementById(targetId);
    
    if (targetElement) {
      targetElement.scrollIntoView({
        behavior: 'smooth'
      });
    }
  });
});

loadProjects();