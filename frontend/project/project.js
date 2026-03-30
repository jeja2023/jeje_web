// 项目详情脚本
import { API_BASE, fetchJSON, escapeHTML, showToast, renderPagination, initFooter } from "/globals/global.js";

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
  if (!dateString) return "暂无";
  const options = { 
    year: "numeric", 
    month: "long", 
    day: "numeric",
    hour: "2-digit", 
    minute: "2-digit", 
    second: "2-digit",
    hour12: false
  };
  return new Date(dateString).toLocaleString("zh-CN", options);
}

function getVideoType(url) {
  const normalized = String(url || "").toLowerCase().split("?")[0];
  if (normalized.endsWith(".mp4") || normalized.endsWith(".m4v")) return "video/mp4";
  if (normalized.endsWith(".webm")) return "video/webm";
  if (normalized.endsWith(".ogg") || normalized.endsWith(".ogv")) return "video/ogg";
  if (normalized.endsWith(".mov") || normalized.endsWith(".qt")) return "video/quicktime";
  if (normalized.endsWith(".avi")) return "video/x-msvideo";
  if (normalized.endsWith(".mkv")) return "video/x-matroska";
  return "";
}

function resolveMediaURL(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, window.location.origin).toString();
  } catch {
    return raw;
  }
}

function splitMediaURLs(raw) {
  if (!raw) return [];
  const seen = new Set();
  const chunks = String(raw)
    .split(/\r?\n|,|，|;|；/)
    .map((item) => item.trim())
    .filter(Boolean);
  const urls = [];
  chunks.forEach((item) => {
    const resolved = resolveMediaURL(item);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    urls.push(resolved);
  });
  return urls;
}

function isLikelyDirectVideoURL(url) {
  const normalized = String(url || "")
    .toLowerCase()
    .split("#")[0]
    .split("?")[0];
  return (
    normalized.includes("/uploads/") ||
    normalized.endsWith(".mp4") ||
    normalized.endsWith(".m4v") ||
    normalized.endsWith(".webm") ||
    normalized.endsWith(".ogg") ||
    normalized.endsWith(".ogv") ||
    normalized.endsWith(".mov") ||
    normalized.endsWith(".qt") ||
    normalized.endsWith(".avi") ||
    normalized.endsWith(".mkv") ||
    normalized.endsWith(".m4v") ||
    normalized.endsWith(".m3u8")
  );
}

function getVideoEmbedURL(rawUrl) {
  try {
    const url = new URL(rawUrl, window.location.origin);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname;

    if (host === "youtu.be" || host.endsWith("youtube.com")) {
      let id = "";
      if (host === "youtu.be") {
        id = pathname.replace(/^\/+/, "").split("/")[0];
      } else {
        id = url.searchParams.get("v") || "";
        if (!id && pathname.startsWith("/shorts/")) {
          id = pathname.split("/")[2] || "";
        }
        if (!id && pathname.startsWith("/embed/")) {
          id = pathname.split("/")[2] || "";
        }
      }
      if (id) return `https://www.youtube.com/embed/${id}`;
    }

    if (host.endsWith("vimeo.com")) {
      const m = pathname.match(/\/(\d+)/);
      if (m && m[1]) return `https://player.vimeo.com/video/${m[1]}`;
    }

    if (host.endsWith("bilibili.com")) {
      const bvid = pathname.match(/\/video\/(BV[0-9A-Za-z]+)/)?.[1] || "";
      if (bvid) return `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bvid)}&page=1`;
      const aidRaw = pathname.match(/\/video\/av(\d+)/)?.[1] || "";
      if (aidRaw) return `https://player.bilibili.com/player.html?aid=${encodeURIComponent(aidRaw)}&page=1`;
    }
  } catch {
    return "";
  }
  return "";
}

function render(project) {
  const safeName = escapeHTML(project.name || "");
  const tags = splitTags(project.tags).map(escapeHTML);
  const coverUrls = splitMediaURLs(project.cover_url);
  const primaryCoverUrl = coverUrls[0] || "";
  const videoUrls = splitMediaURLs(project.video_url);
  const tagsHtml = tags.length
    ? `<div class="tag-list flex justify-center mt-3">${tags.map((tag) => `<span class="tag-chip">${tag}</span>`).join("")}</div>`
    : "";

  let coverHtml = "";
  if (coverUrls.length) {
    let coverVisualContent = "";
    if (coverUrls.length === 1) {
      coverVisualContent = `<img src="${escapeHTML(coverUrls[0])}" alt="${safeName}" class="project-image" loading="lazy" />`;
    } else {
      // 轮播图结构 / Carousel Structure
      const slides = coverUrls.map((url, i) => `
        <div class="carousel-slide ${i === 0 ? 'active' : ''}" data-index="${i}">
          <img src="${escapeHTML(url)}" alt="${safeName} - ${i + 1}" />
        </div>
      `).join("");
      
      const dots = coverUrls.map((_, i) => `
        <span class="carousel-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></span>
      `).join("");

      coverVisualContent = `
        <div class="carousel-wrapper" id="projectCarousel">
          <div class="carousel-container">
            ${slides}
          </div>
          <button class="carousel-btn carousel-prev" aria-label="上一张">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <button class="carousel-btn carousel-next" aria-label="下一张">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
          <div class="carousel-dots">
            ${dots}
          </div>
        </div>
      `;
    }

    coverHtml = `
      <figure class="project-visuals">
        <div class="project-visual-meta">
          <span class="project-visual-badge">项目图片</span>
          <p>${coverUrls.length > 1 ? `共 ${coverUrls.length} 张展示图，点击左右切换查看。` : "用于展示界面、流程或关键功能画面。"}</p>
        </div>
        ${coverVisualContent}
      </figure>
    `;
  }

  let videoHtml = "";
  if (videoUrls.length) {
    videoHtml = videoUrls
      .map((videoUrl, index) => {
        const embedUrl = getVideoEmbedURL(videoUrl);
        const badge = videoUrls.length > 1 ? `视频演示 ${index + 1}` : "视频演示";
        const safeVideoURL = escapeHTML(videoUrl);

        if (isLikelyDirectVideoURL(videoUrl)) {
          const videoType = getVideoType(videoUrl);
          const videoTypeAttr = videoType ? ` type="${videoType}"` : "";
          const posterAttr = primaryCoverUrl ? ` poster="${escapeHTML(primaryCoverUrl)}"` : "";
          
          return `
            <figure class="project-visuals">
              <div class="project-visual-meta">
                <span class="project-visual-badge">${badge}</span>
                <p>通过视频快速浏览交互流程与页面节奏。</p>
              </div>
              <div class="project-video-container">
                <video class="project-video" controls preload="metadata" playsinline${posterAttr}>
                  <source src="${safeVideoURL}"${videoTypeAttr}>
                  您的浏览器不支持 HTML5 视频播放。
                </video>
              </div>
              <p class="project-video-help">
                视频无法播放？建议检查格式或
                <a href="${safeVideoURL}" target="_blank" rel="noopener noreferrer">在新窗口尝试直接打开</a>
              </p>
            </figure>
          `;
        }

        if (embedUrl) {
          const safeEmbedURL = escapeHTML(embedUrl);
          return `
            <figure class="project-visuals">
              <div class="project-visual-meta">
                <span class="project-visual-badge">${badge}</span>
                <p>三方平台视频，使用嵌入式播放器展示。</p>
              </div>
              <iframe
                class="project-video-embed"
                src="${safeEmbedURL}"
                loading="lazy"
                referrerpolicy="strict-origin-when-cross-origin"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowfullscreen
              ></iframe>
              <p class="project-video-help">
                如无法播放，请访问 
                <a href="${safeVideoURL}" target="_blank" rel="noopener noreferrer">原始平台查看</a>
              </p>
            </figure>
          `;
        }

        return `
          <figure class="project-visuals">
            <div class="project-visual-meta">
              <span class="project-visual-badge">${badge}</span>
              <p>非视频格式链接或三方平台链接。</p>
            </div>
            <div class="project-video-fallback">
              <a class="btn primary" href="${safeVideoURL}" target="_blank" rel="noopener noreferrer">手动打开演示页面</a>
            </div>
          </figure>
        `;
      })
      .join("");
  }
  const visualHtml =
    coverHtml || videoHtml ? `<div class="project-media-stack">${coverHtml}${videoHtml}</div>` : "";

  let htmlContent = "<p class='text-center text-muted'>暂无详细介绍信息。</p>";
  let tocHTML = "";
  let readingTimeStr = "1 分钟";

  if (project.content_html) {
    const mdRaw = project.content_html;
    const wordCount = mdRaw.replace(/<[^>]+>/g, '').length;
    readingTimeStr = Math.max(1, Math.ceil(wordCount / 300)) + " 分钟";

    if (typeof marked !== 'undefined') {
      marked.setOptions({
        highlight: function (code, lang) {
          if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
          }
          return hljs.highlightAuto(code).value;
        }
      });

      const renderer = new marked.Renderer();
      let headings = [];
      renderer.heading = function(text, level, raw) {
        const id = 'heading-' + Math.random().toString(36).substr(2, 6);
        if (level === 2 || level === 3) {
          headings.push({ text, level, id });
        }
        return `<h${level} id="${id}">${text}</h${level}>`;
      };
      marked.use({ renderer });

      htmlContent = marked.parse(mdRaw);

      if (headings.length > 0) {
        tocHTML = '<div class="toc-sidebar card"><h4>文章目录</h4><ul class="toc-list">';
        headings.forEach(h => {
          const cls = h.level === 2 ? 'toc-h2' : 'toc-h3';
          tocHTML += `<li class="${cls}"><a href="#${h.id}">${h.text}</a></li>`;
        });
        tocHTML += '</ul></div>';
      }
    } else {
      htmlContent = project.content_html;
    }
  }

  detail.innerHTML = `
    <div class="project-header">
      <h1 class="project-title">${safeName}</h1>
      ${tagsHtml}
      <div class="project-meta-bar">
        <div class="project-meta-item">
          <span>浏览</span>
          <strong>${project.view_count || 0}</strong>
        </div>
        <div class="project-meta-item">
          <span>阅读</span>
          <strong>${readingTimeStr}</strong>
        </div>
        <div class="project-meta-item">
          <span>日期</span>
          <strong>${formatDate(project.created_at)}</strong>
        </div>
      </div>
    </div>

    ${visualHtml}

    <div class="project-layout">
      <div class="project-main">
        <div class="project-content markdown-body">
          ${htmlContent}
        </div>
        
        <div class="project-actions">
          ${project.external_url ? `<a class="btn primary" href="${project.external_url}" target="_blank" rel="noopener noreferrer">查看线上体验</a>` : ""}
          <a href="/" class="btn">返回作品列表</a>
        </div>
      </div>
      ${tocHTML ? `<aside class="project-sidebar">${tocHTML}</aside>` : ''}
    </div>
  `;

  setupCarousel();

  // 直链视频加载失败时，强调外链兜底入口，避免用户无感失败
  detail.querySelectorAll(".project-video").forEach((video) => {
    video.addEventListener(
      "error",
      () => {
        const hint = video.closest(".project-visuals")?.querySelector(".project-video-help");
        if (hint) {
          hint.classList.add("is-error");
          const source = video.querySelector("source")?.src || "";
          hint.innerHTML = `视频播放失败，请尝试 <a href="${escapeHTML(source)}" target="_blank">直接下载/播放源文件</a>`;
        }
      },
      { once: true }
    );
  });
}

function setupCarousel() {
  const carousel = document.getElementById("projectCarousel");
  if (!carousel) return;

  const slides = carousel.querySelectorAll(".carousel-slide");
  const dots = carousel.querySelectorAll(".carousel-dot");
  const prevBtn = carousel.querySelector(".carousel-prev");
  const nextBtn = carousel.querySelector(".carousel-next");
  
  let currentIndex = 0;
  const total = slides.length;

  function showSlide(index) {
    if (index < 0) index = total - 1;
    if (index >= total) index = 0;
    
    slides.forEach(s => s.classList.remove("active"));
    dots.forEach(d => d.classList.remove("active"));
    
    slides[index].classList.add("active");
    dots[index].classList.add("active");
    currentIndex = index;
  }

  if (prevBtn) prevBtn.onclick = () => showSlide(currentIndex - 1);
  if (nextBtn) nextBtn.onclick = () => showSlide(currentIndex + 1);
  
  dots.forEach((dot, i) => {
    dot.onclick = () => showSlide(i);
  });

  // 简单自动播放（每 6 秒切换一次）
  let timer = setInterval(() => showSlide(currentIndex + 1), 6000);
  carousel.onmouseenter = () => clearInterval(timer);
  carousel.onmouseleave = () => timer = setInterval(() => showSlide(currentIndex + 1), 6000);
}

async function load() {
  const id = getProjectId();
  if (!id) {
    detail.innerHTML = "<div class='text-center'>缺少项目编号。</div>";
    return;
  }

try {
    const project = await fetchJSON(`${API_BASE}/projects/${id}`);
    render(project);
    document.title = `${project.name} | JEJE Web`;

    // load comments
    state.project_id = id;
    if (commentProjectId) commentProjectId.value = id;
    await loadCaptcha();
    await loadComments(1);
    
  } catch (err) {
    detail.innerHTML = `<div class='text-center text-error'>加载作品详情失败：${err.message}</div>`;
  }
}

// ----------------- Comments logic -----------------
const commentForm = document.getElementById("commentForm");
const commentProjectId = document.getElementById("commentProjectId");
const commentsList = document.getElementById("commentsList");
const commentsPagination = document.getElementById("commentsPagination");
const captchaQuestion = document.getElementById("captchaQuestion");
const refreshCaptchaBtn = document.getElementById("refreshCaptchaBtn");
const captchaIdInput = document.querySelector("input[name='captcha_id']");
const captchaAnswerInput = document.querySelector("input[name='captcha_answer']");

const state = {
  project_id: null,
  page: 1,
  limit: 10
};

async function loadCaptcha() {
  if (!captchaQuestion) return;
  try {
    const data = await fetchJSON(`${API_BASE}/captcha`);
    captchaIdInput.value = data.id || "";
    captchaQuestion.textContent = data.question || "验证码";
    if (captchaAnswerInput) captchaAnswerInput.value = "";
  } catch (err) {
    captchaQuestion.textContent = "验证码加载失败";
  }
}

if (refreshCaptchaBtn) {
  refreshCaptchaBtn.addEventListener("click", loadCaptcha);
}

function renderComment(msg, index = 0) {
  const item = document.createElement("div");
  item.className = "message stagger-item";
  item.style.setProperty("--stagger-index", String(index));

  const metaRow = document.createElement("div");
  metaRow.className = "meta-row";

  const metaStr = `#${msg.id} ${escapeHTML(msg.nickname)}`;
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = metaStr;

  const date = document.createElement("div");
  date.className = "message-date";
  date.textContent = formatDate(msg.created_at);
  date.style.opacity = "0.6";

  metaRow.append(meta, date);

  const content = document.createElement("div");
  content.textContent = msg.content;
  item.append(metaRow, content);

  if (msg.replies && msg.replies.length > 0) {
    const repliesDiv = document.createElement("div");
    repliesDiv.className = "replies";
    msg.replies.forEach(reply => {
      const r = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = "杰哥回复：";
      r.append(strong, document.createTextNode(reply.content));
      repliesDiv.appendChild(r);
    });
    item.appendChild(repliesDiv);
  }

  return item;
}

async function loadComments(page = 1) {
  if (!commentsList || !state.project_id) return;
  state.page = page;
  
  try {
    const query = new URLSearchParams({
      page: state.page,
      limit: state.limit,
      project_id: state.project_id
    });
    
    const data = await fetchJSON(`${API_BASE}/messages?${query}`);
    const msgs = data.data || [];
    commentsList.innerHTML = "";

    if (!msgs.length) {
      commentsList.innerHTML = "<p class='text-center text-muted'>暂无留言，来说两句吧。</p>";
      if (commentsPagination) commentsPagination.innerHTML = "";
      return;
    }

    msgs.forEach((msg, index) => {
      commentsList.appendChild(renderComment(msg, index));
    });

    if (commentsPagination) {
      renderPagination({
        container: commentsPagination,
        total: data.total || msgs.length,
        current: data.page || state.page,
        limit: data.limit || state.limit,
        onPageChange: loadComments,
      });
    }
  } catch (err) {
    commentsList.innerHTML = `<p class='text-center text-error'>留言加载失败：${err.message}</p>`;
  }
}

if (commentForm) {
  commentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (commentForm.website?.value) {
      showToast("检测到异常请求", "error");
      return;
    }

    // Convert string project_id to number before sending
    const pId = parseInt(state.project_id, 10);
    const payload = Object.fromEntries(new FormData(commentForm).entries());
    payload.project_id = pId;

    try {
      await fetchJSON(`${API_BASE}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      showToast("留言已提交审核，我会尽快回复你 :)", "success");
      commentForm.reset();
      commentProjectId.value = state.project_id;
      await loadCaptcha();
    } catch (err) {
      showToast(`留言提交失败：${err.message}`, "error");
    }
  });
}

load();
initFooter();
