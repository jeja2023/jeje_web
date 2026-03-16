// 首页脚本 / Home Script
import { API_BASE, fetchJSON, formatDate, renderPagination, escapeHTML } from "/globals/global.js";

const grid = document.getElementById("projectGrid");
const pagination = document.getElementById("projectPagination");
const searchInput = document.getElementById("projectSearchInput");
const searchBtn = document.getElementById("projectSearchBtn");
const searchReset = document.getElementById("projectSearchReset");
const tagList = document.getElementById("projectTagList");

const state = {
  page: 1,
  limit: 12,
  q: "",
  tag: "",
  tags: [],
};

function splitTags(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function renderTagFilters(tags) {
  if (!tagList) return;
  const allTags = ["全部", ...tags];
  tagList.innerHTML = "";
  allTags.forEach((tag) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tag-filter";
    btn.textContent = tag;
    const value = tag === "全部" ? "" : tag;
    if (state.tag === value) {
      btn.classList.add("active");
    }
    btn.addEventListener("click", () => {
      state.tag = value;
      tagList.querySelectorAll(".tag-filter").forEach((el) => el.classList.remove("active"));
      btn.classList.add("active");
      loadProjects(1);
    });
    tagList.appendChild(btn);
  });
}

function projectCard(project) {
  const card = document.createElement("a");
  card.className = "card animate-fade-in";
  card.href = `/project?id=${project.id}`;

  const safeName = escapeHTML(project.name || "");
  const safeSummary = escapeHTML(project.summary || "暂无简介");
  const tags = splitTags(project.tags).map(escapeHTML);

  const coverHtml = project.cover_url 
    ? `<div class="card-img-wrapper"><img src="${project.cover_url}" class="card-img" alt="${safeName}" loading="lazy"></div>`
    : `<div class="card-img-wrapper" style="display:flex;align-items:center;justify-content:center;background:var(--bg-offset);color:var(--subtle);font-size:0.8rem;">NO IMAGE</div>`;
    
  const tagsHtml = tags.length
    ? `<div class="tag-list">${tags.map((tag) => `<span class="tag-chip">${tag}</span>`).join("")}</div>`
    : "";

  card.innerHTML = `
    ${coverHtml}
    <div class="card-body">
      <div class="card-title">${safeName}</div>
      <div class="card-summary">${safeSummary}</div>
      <div style="margin-top: auto; padding-top: 16px;">
        ${tagsHtml}
        <div class="flex justify-between items-center mt-2" style="font-size: 0.8rem; color: var(--subtle);">
          <span>${formatDate(project.created_at)}</span>
          <span>${project.view_count || 0} VIEWS</span>
        </div>
      </div>
    </div>
  `;
  return card;
}


async function loadProjects(page = state.page) {
  try {
    state.page = page;
    const params = new URLSearchParams({ page: String(state.page), limit: String(state.limit) });
    if (state.q) params.set("q", state.q);
    if (state.tag) params.set("tag", state.tag);
    const data = await fetchJSON(`${API_BASE}/projects?${params.toString()}`);
    const list = data.data || [];
    grid.innerHTML = "";
    if (!list.length) {
      grid.innerHTML = `<div class="card">暂无项目。</div>`;
      if (pagination) pagination.innerHTML = "";
      return;
    }
    list.forEach((project) => grid.appendChild(projectCard(project)));
    if (pagination) {
      renderPagination({
        container: pagination,
        total: data.total || list.length,
        current: data.page || state.page,
        limit: data.limit || state.limit,
        onPageChange: loadProjects,
      });
    }
  } catch (err) {
    grid.innerHTML = `<div class="card">加载失败：${err.message}</div>`;
  }
}

async function loadTags() {
  if (!tagList) return;
  try {
    const data = await fetchJSON(`${API_BASE}/projects/tags`);
    state.tags = data.data || [];
    renderTagFilters(state.tags);
  } catch (err) {
    tagList.innerHTML = "";
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

if (searchBtn) {
  searchBtn.addEventListener("click", () => {
    state.q = searchInput ? searchInput.value.trim() : "";
    loadProjects(1);
  });
}

if (searchReset) {
  searchReset.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    state.q = "";
    state.tag = "";
    renderTagFilters(state.tags || []);
    loadProjects(1);
  });
}

loadTags().finally(() => loadProjects());
