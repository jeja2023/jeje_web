// 首页脚本
import { API_BASE, fetchJSON, formatDate, renderPagination, escapeHTML, initFooter } from "/globals/global.js";

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

function projectCard(project, index) {
  const card = document.createElement("a");
  card.className = "card project-card stagger-item";
  card.href = `/project?id=${project.id}`;
  card.style.setProperty("--stagger-index", String(index));

  const safeName = escapeHTML(project.name || "");
  const safeSummary = escapeHTML(project.summary || "暂无简介");
  const tags = splitTags(project.tags).map(escapeHTML);

  const coverUrls = (project.cover_url || "")
    .split(/\r?\n|,|，|;|；/)
    .map((u) => u.trim())
    .filter(Boolean);
  const primaryCover = coverUrls[0] || "";

  const coverHtml = primaryCover
    ? `<div class="card-img-wrapper"><img src="${escapeHTML(primaryCover)}" class="card-img" alt="${safeName}" loading="lazy"></div>`
    : `<div class="card-img-wrapper card-img-placeholder">暂无封面</div>`;

  const tagsHtml = tags.length
    ? `<div class="tag-list">${tags.map((tag) => `<span class="tag-chip">${tag}</span>`).join("")}</div>`
    : "";

  card.innerHTML = `
    ${coverHtml}
    <div class="card-body">
      <div class="card-title">${safeName}</div>
      <div class="card-summary">${safeSummary}</div>
      <div class="card-meta-wrap">
        ${tagsHtml}
        <div class="card-meta-row flex justify-between items-center mt-2">
          <span>${formatDate(project.created_at)}</span>
          <span>${project.view_count || 0} 次浏览</span>
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
      grid.innerHTML = `<div class="empty-state">当前没有匹配的作品，试试更换关键词或标签。</div>`;
      if (pagination) pagination.innerHTML = "";
      return;
    }

    list.forEach((project, index) => grid.appendChild(projectCard(project, index)));

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
    grid.innerHTML = `<div class="empty-state">加载失败：${err.message}</div>`;
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

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", function onAnchorClick(event) {
    event.preventDefault();
    const targetId = this.getAttribute("href").substring(1);
    const targetElement = document.getElementById(targetId);

    if (targetElement) {
      targetElement.scrollIntoView({ behavior: "smooth" });
    }
  });
});

if (searchBtn) {
  searchBtn.addEventListener("click", () => {
    state.q = searchInput ? searchInput.value.trim() : "";
    loadProjects(1);
  });
}

if (searchInput) {
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    state.q = searchInput.value.trim();
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
initFooter();
