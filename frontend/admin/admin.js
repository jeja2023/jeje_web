// 管理后台脚本
import { API_BASE, fetchJSON, formatDate, showToast, showModal, renderPagination } from "/globals/global.js";

const loginCard = document.getElementById("loginCard");
const loginForm = document.getElementById("loginForm");
const adminPanel = document.getElementById("adminPanel");
const tabs = document.querySelectorAll(".tab");
const tabDashboard = document.getElementById("tab-dashboard");
const tabMessages = document.getElementById("tab-messages");
const tabProjects = document.getElementById("tab-projects");
const tabSettings = document.getElementById("tab-settings");
const tabPanels = [tabDashboard, tabMessages, tabProjects, tabSettings].filter(Boolean);
const passwordForm = document.getElementById("passwordForm");

const adminMessageList = document.getElementById("adminMessageList");
const messageSearch = document.getElementById("messageSearch");
const messageStatusFilter = document.getElementById("messageStatusFilter");
const messageSearchBtn = document.getElementById("messageSearchBtn");
const messageResetBtn = document.getElementById("messageResetBtn");
const messagePagination = document.getElementById("messagePagination");

const projectList = document.getElementById("projectList");
const projectSearch = document.getElementById("projectSearch");
const projectTagFilter = document.getElementById("projectTagFilter");
const projectPublicFilter = document.getElementById("projectPublicFilter");
const projectSearchBtn = document.getElementById("projectSearchBtn");
const projectResetBtn = document.getElementById("projectResetBtn");
const projectPagination = document.getElementById("projectPagination");
const projectForm = document.getElementById("projectForm");

const logoutBtn = document.getElementById("logoutBtn");
const contentHtml = document.getElementById("contentHtml");
let mdeEditor = null;

const coverUploadBtn = document.getElementById("coverUploadBtn");
const coverUploadInput = document.getElementById("coverUploadInput");
const videoUploadBtn = document.getElementById("videoUploadBtn");
const videoUploadInput = document.getElementById("videoUploadInput");

const statsProjects = document.getElementById("stats-projects");
const statsMessages = document.getElementById("stats-messages");
const statsPending = document.getElementById("stats-pending");
const statsToday = document.getElementById("stats-today");
const statsViews = document.getElementById("stats-views");

const coverUrlInput = projectForm?.querySelector('[name="cover_url"]');
const videoUrlInput = projectForm?.querySelector('[name="video_url"]');
const uploadedMediaList = document.getElementById("uploadedMediaList");
const coverPickerBtn = document.getElementById("coverPickerBtn");
const videoPickerBtn = document.getElementById("videoPickerBtn");
const coverPreviewList = document.getElementById("coverPreviewList");
const videoPreviewList = document.getElementById("videoPreviewList");

const state = {
  messages: [],
  projects: [],
  statsLoaded: false,
  uploadMaxMB: 1024,
  messageQuery: { page: 1, limit: 20, q: "", status: "" },
  projectQuery: { page: 1, limit: 20, q: "", tag: "", is_public: "" },
};



function bindEnterSearch(input, callback) {
  if (!input) return;
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    callback();
  });
}

function applyMessageFilters() {
  state.messageQuery.q = messageSearch ? messageSearch.value.trim() : "";
  state.messageQuery.status = messageStatusFilter ? messageStatusFilter.value : "";
  loadMessages(1);
}

function applyProjectFilters() {
  state.projectQuery.q = projectSearch ? projectSearch.value.trim() : "";
  state.projectQuery.tag = projectTagFilter ? projectTagFilter.value.trim() : "";
  state.projectQuery.is_public = projectPublicFilter ? projectPublicFilter.value : "";
  loadProjects(1);
}

function isAuthError(err) {
  if (!err) return false;
  if (err.status === 401 || err.status === 403) return true;
  return /unauthorized|session|未登录|会话无效|登录已过期|未授权/i.test(err.message || "");
}

function buildQueryParams(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== "" && value !== null && value !== undefined) {
      query.set(key, String(value));
    }
  });
  return query.toString();
}

function statusLabel(status) {
  if (status === 1) return "已公开";
  if (status === 2) return "已隐藏";
  return "待审核";
}

function splitTags(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function splitMediaUrls(raw) {
  if (!raw) return [];
  const normalized = String(raw).trim();
  if (!normalized) return [];

  const source = normalized
    .split(/\r?\n|,|，|;|；/)
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((item) => {
      const uploadMatches = item.match(/\/uploads\/.*?\.(?:jpg|jpeg|png|gif|webp|mp4|webm|ogg|ogv|mov|m4v|m3u8)(?:\?[^/\s,，;；]*)?(?=(?:\/uploads\/|$))/gi);
      if (uploadMatches && uploadMatches.length > 1) return uploadMatches;
      const absoluteMatches = item.match(/https?:\/\/.*?(?=(?:https?:\/\/|$))/gi);
      if (absoluteMatches && absoluteMatches.length > 1) return absoluteMatches;
      return [item];
    });

  const seen = new Set();
  const urls = [];
  source.forEach((item) => {
    const resolved = resolveMediaURL(item);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    urls.push(resolved);
  });
  return urls;
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
        if (!id && pathname.startsWith("/shorts/")) id = pathname.split("/")[2] || "";
        if (!id && pathname.startsWith("/embed/")) id = pathname.split("/")[2] || "";
      }
      if (id) return `https://www.youtube.com/embed/${id}`;
    }

    if (host.endsWith("vimeo.com")) {
      const match = pathname.match(/\/(\d+)/);
      if (match && match[1]) return `https://player.vimeo.com/video/${match[1]}`;
    }

    if (host.endsWith("bilibili.com")) {
      const bvid = pathname.match(/\/video\/(BV[0-9A-Za-z]+)/)?.[1] || "";
      if (bvid) return `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(bvid)}&page=1`;
      const aid = pathname.match(/\/video\/av(\d+)/)?.[1] || "";
      if (aid) return `https://player.bilibili.com/player.html?aid=${encodeURIComponent(aid)}&page=1`;
    }
  } catch {
    return "";
  }
  return "";
}

function appendMediaUrls(field, urls) {
  if (!field || !urls || !urls.length) return;
  const current = splitMediaUrls(field.value || "");
  const merged = [...current];
  urls.forEach((url) => {
    if (url && !merged.includes(url)) merged.push(url);
  });
  field.value = merged.join("\n");
}

function removeMediaUrl(field, targetUrl) {
  if (!field || !targetUrl) return;
  const next = splitMediaUrls(field.value || "").filter((url) => url !== targetUrl);
  field.value = next.join("\n");
}

function setMediaAsPrimary(field, targetUrl) {
  if (!field || !targetUrl) return;
  const urls = splitMediaUrls(field.value || "");
  const filtered = urls.filter((url) => url !== targetUrl);
  const next = [targetUrl, ...filtered];
  field.value = next.join("\n");
}

function syncUploadLimit(data) {
  const value = Number(data?.upload_max_mb);
  if (Number.isFinite(value) && value > 0) {
    state.uploadMaxMB = value;
  }
}

function getUploadLimitBytes() {
  return state.uploadMaxMB * 1024 * 1024;
}

function formatUploadLimitHint() {
  return `${state.uploadMaxMB}MB`;
}

function isFileTooLarge(file) {
  return Boolean(file && file.size > getUploadLimitBytes());
}

function splitFilesByUploadLimit(files) {
  const accepted = [];
  const rejected = [];
  files.forEach((file) => {
    if (isFileTooLarge(file)) {
      rejected.push(file);
      return;
    }
    accepted.push(file);
  });
  return { accepted, rejected };
}

function buildTooLargeMessage(file) {
  return `${file.name}: 超过 ${formatUploadLimitHint()} 上传上限`;
}

function notifyRejectedFiles(files, kindLabel) {
  if (!files.length) return;
  showToast(`${files.length} 个${kindLabel}超过 ${formatUploadLimitHint()}，已跳过上传`, "error");
}

function renderUploadedMediaList() {
  if (!uploadedMediaList) return;

  const imageUrls = splitMediaUrls(coverUrlInput?.value || "");
  const videoUrls = splitMediaUrls(videoUrlInput?.value || "");
  uploadedMediaList.innerHTML = "";

  if (!imageUrls.length && !videoUrls.length) {
    const empty = document.createElement("div");
    empty.className = "media-empty";
    empty.textContent = "暂无媒体 URL，上传后会显示在这里。";
    uploadedMediaList.appendChild(empty);
    return;
  }

  const allItems = [
    ...imageUrls.map((url) => ({ type: "image", url })),
    ...videoUrls.map((url) => ({ type: "video", url })),
  ];

  allItems.forEach((item) => {
    const row = document.createElement("div");
    row.className = "media-list-item";

    const kind = document.createElement("span");
    kind.className = `media-kind ${item.type}`;
    kind.textContent = item.type === "image" ? "图片" : "视频";

    const url = document.createElement("a");
    url.className = "media-url";
    url.href = item.url;
    url.target = "_blank";
    url.rel = "noreferrer";
    url.title = item.url;
    url.textContent = item.url;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "media-remove-btn";
    removeBtn.textContent = "删除";
    removeBtn.addEventListener("click", () => {
      if (item.type === "image") {
        removeMediaUrl(coverUrlInput, item.url);
        if (coverUrlInput) coverUrlInput.dispatchEvent(new Event("input"));
      } else {
        removeMediaUrl(videoUrlInput, item.url);
        if (videoUrlInput) videoUrlInput.dispatchEvent(new Event("input"));
      }
      renderUploadedMediaList();
      showToast("已删除 1 条媒体 URL", "info");
    });

    row.append(kind, url, removeBtn);
    uploadedMediaList.appendChild(row);
  });
}

function renderEmptyPreview(container, meta, message) {
  if (!container) return;
  container.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "media-empty";
  empty.textContent = message;
  container.appendChild(empty);
  if (meta) meta.textContent = message;
}

function renderMediaPreview() {
  const imageUrls = splitMediaUrls(coverUrlInput?.value || "");
  const videoUrls = splitMediaUrls(videoUrlInput?.value || "");

  if (coverPreviewList) {
    coverPreviewList.innerHTML = "";
    if (imageUrls.length === 0) {
      renderEmptyPreview(coverPreviewList, null, "暂无项图片");
    } else {
      imageUrls.forEach((url, index) => {
        const card = document.createElement("div");
        card.className = "media-preview-card-refined";
        if (index === 0) card.classList.add("is-cover");

        const img = document.createElement("img");
        img.src = url;
        img.alt = `图片 ${index + 1}`;
        img.loading = "lazy";

        const actions = document.createElement("div");
        actions.className = "media-preview-actions";

        if (index > 0) {
          const setPrimaryBtn = document.createElement("button");
          setPrimaryBtn.type = "button";
          setPrimaryBtn.className = "btn small primary";
          setPrimaryBtn.textContent = "设为封面";
          setPrimaryBtn.onclick = () => {
            setMediaAsPrimary(coverUrlInput, url);
            renderMediaPreview();
            renderUploadedMediaList();
            showToast("已设为封面", "success");
          };
          actions.appendChild(setPrimaryBtn);
        } else {
          const badge = document.createElement("span");
          badge.className = "media-cover-badge";
          badge.textContent = "当前封面";
          card.appendChild(badge);
        }

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "btn small danger";
        deleteBtn.textContent = "移除";
        deleteBtn.onclick = () => {
          removeMediaUrl(coverUrlInput, url);
          renderMediaPreview();
          renderUploadedMediaList();
          showToast("已移除图片", "info");
        };
        actions.appendChild(deleteBtn);

        card.append(img, actions);
        coverPreviewList.appendChild(card);
      });
    }
  }

  if (videoPreviewList) {
    videoPreviewList.innerHTML = "";
    if (videoUrls.length === 0) {
      renderEmptyPreview(videoPreviewList, null, "暂无视频");
    } else {
      videoUrls.forEach((url, index) => {
        const card = document.createElement("div");
        card.className = "media-preview-card-refined is-video";

        const embedUrl = getVideoEmbedURL(url);
        if (embedUrl) {
          const iframe = document.createElement("iframe");
          iframe.src = embedUrl;
          card.appendChild(iframe);
        } else if (isLikelyDirectVideoURL(url)) {
          const video = document.createElement("video");
          video.src = url;
          video.controls = true;
          card.appendChild(video);
        }

        const actions = document.createElement("div");
        actions.className = "media-preview-actions";

        if (index > 0) {
          const setPrimaryBtn = document.createElement("button");
          setPrimaryBtn.type = "button";
          setPrimaryBtn.className = "btn small primary";
          setPrimaryBtn.textContent = "设为主要视频";
          setPrimaryBtn.onclick = () => {
            setMediaAsPrimary(videoUrlInput, url);
            renderMediaPreview();
            renderUploadedMediaList();
            showToast("已调整视频顺序", "success");
          };
          actions.appendChild(setPrimaryBtn);
        } else {
          const badge = document.createElement("span");
          badge.className = "media-cover-badge";
          badge.style.background = "var(--warm)";
          badge.textContent = "主要展示";
          card.appendChild(badge);
        }

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "btn small danger";
        deleteBtn.textContent = "移除视频";
        deleteBtn.onclick = () => {
          removeMediaUrl(videoUrlInput, url);
          renderMediaPreview();
          renderUploadedMediaList();
        };
        actions.appendChild(deleteBtn);

        card.appendChild(actions);
        videoPreviewList.appendChild(card);
      });
    }
  }
}

async function showGlobalPicker(field) {
  try {
    const data = await fetchJSON(`${API_BASE}/admin/uploads`);
    const files = data.data || [];

    if (files.length === 0) {
      showToast("资源库中暂无文件，请先上传", "info");
      return;
    }

    const content = document.createElement("div");
    content.className = "global-picker-grid";
    
    files.forEach(file => {
      const item = document.createElement("div");
      item.className = "picker-item";
      
      const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name);
      if (isImage) {
        const img = document.createElement("img");
        img.src = file.url;
        item.appendChild(img);
      } else {
        const icon = document.createElement("div");
        icon.className = "picker-icon";
        icon.textContent = "🎬";
        item.appendChild(icon);
      }

      const name = document.createElement("div");
      name.className = "picker-name";
      name.textContent = file.name;
      item.appendChild(name);

      item.onclick = () => {
        appendMediaUrls(field, [file.url]);
        renderMediaPreview();
        renderUploadedMediaList();
        showToast("已添加资源", "success");
        // Modal closes automatically via global.js showModal logic if we use it, 
        // but here we manually handle closing if needed or just let the user pick multiple
      };
      
      content.appendChild(item);
    });

    showModal({
      title: "资源库文件选择",
      content: content.outerHTML,
      confirmText: "完成选择",
      onConfirm: () => {}
    });

    // Re-bind clicks because outerHTML destroys listeners
    setTimeout(() => {
      const currentModal = document.querySelector(".modal-overlay.active");
      if (!currentModal) return;
      currentModal.querySelectorAll(".picker-item").forEach((el, idx) => {
        el.onclick = () => {
          appendMediaUrls(field, [files[idx].url]);
          renderMediaPreview();
          renderUploadedMediaList();
          showToast(`已选择: ${files[idx].name}`, "success");
        };
      });
    }, 100);

  } catch (err) {
    showToast(`获取资源庫失败: ${err.message}`, "error");
  }
}

function renderTagList(tags) {
  if (!tags || !tags.length) return null;
  const wrap = document.createElement("div");
  wrap.className = "tag-list";
  tags.forEach((tag) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = tag;
    wrap.appendChild(chip);
  });
  return wrap;
}

function createStatusPill(status) {
  const pill = document.createElement("span");
  pill.className = `pill status-${status}`;
  pill.textContent = statusLabel(status);
  return pill;
}

function createActionButton(label, onClick, options = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `btn small${options.primary ? " primary" : ""}`;
  btn.textContent = label;
  if (options.danger) btn.classList.add("danger");
  if (options.disabled) btn.disabled = true;
  btn.addEventListener("click", onClick);
  return btn;
}

function createStatusCard(title, description) {
  const card = document.createElement("div");
  card.className = "panel-card list-status";
  card.innerHTML = `
    <div>
      <strong>${title}</strong>
      <span>${description}</span>
    </div>
  `;
  return card;
}

function setLoggedIn(loggedIn) {
  if (loginCard) loginCard.hidden = loggedIn;
  if (adminPanel) adminPanel.hidden = !loggedIn;
  if (!loggedIn) {
    state.statsLoaded = false;
  }
}

function hidePanel(panel) {
  if (!panel) return;
  panel.classList.remove("is-visible");
  panel.hidden = true;
}

function showPanel(panel) {
  if (!panel) return;
  panel.hidden = false;
  panel.classList.remove("is-visible");
  void panel.offsetWidth;
  requestAnimationFrame(() => {
    panel.classList.add("is-visible");
  });
}

function showTab(name) {
  tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === name);
    tab.classList.toggle("is-pending", tab.dataset.tab !== name);
  });

  tabPanels.forEach((panel) => {
    if (!panel) return;
    if (panel.id === `tab-${name}`) {
      showPanel(panel);
    } else {
      hidePanel(panel);
    }
  });

  if (name === "dashboard") loadStats();
}

async function updateMessageStatus(id, status) {
  try {
    await fetchJSON(`${API_BASE}/admin/messages/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    showToast("状态更新成功", "success");
    await loadMessages(state.messageQuery.page);
  } catch (err) {
    showToast(`状态更新失败：${err.message}`, "error");
  }
}

async function deleteMessage(id) {
  showModal({
    title: "确认删除",
    content: "确定要删除这条留言吗？此操作不可撤销。",
    onConfirm: async () => {
      try {
        await fetchJSON(`${API_BASE}/admin/messages/${id}`, { method: "DELETE" });
        showToast("留言已删除", "success");
        await loadMessages(state.messageQuery.page);
      } catch (err) {
        showToast(`删除失败：${err.message}`, "error");
      }
    },
  });
}

async function deleteProject(id) {
  showModal({
    title: "确认删除",
    content: "确定要删除这个作品吗？",
    onConfirm: async () => {
      try {
        await fetchJSON(`${API_BASE}/admin/projects/${id}`, { method: "DELETE" });
        showToast("作品已删除", "success");
        await loadProjects(state.projectQuery.page);
      } catch (err) {
        showToast(`删除失败：${err.message}`, "error");
      }
    },
  });
}

function renderReplies(container, replies) {
  if (!replies || !replies.length) return;
  replies.forEach((reply) => {
    const replyEl = document.createElement("div");
    replyEl.className = "reply";
    replyEl.innerHTML = `
      <div class="reply-header">
        <span>管理员回复</span>
        <span class="text-muted" style="font-weight: 400; font-size: 0.75rem;">${formatDate(reply.created_at)}</span>
      </div>
      <div class="reply-content">${reply.content}</div>
    `;
    container.appendChild(replyEl);
  });
}

function renderAdminMessage(msg, index = 0) {
  const item = document.createElement("div");
  item.className = "message stagger-item";
  item.id = `message-${msg.id}`;
  item.style.setProperty("--stagger-index", String(index));

  const metaRow = document.createElement("div");
  metaRow.className = "flex justify-between items-start mb-3";

  const metaStack = document.createElement("div");
  metaStack.className = "message-meta-stack";
  
  const mainMeta = document.createElement("div");
  mainMeta.className = "meta mb-1";
  mainMeta.innerHTML = `<strong class="text-accent-strong">#${msg.id} ${msg.nickname}</strong> · ${formatDate(msg.created_at)}`;
  
  metaStack.appendChild(mainMeta);

  // Add more metadata
  const items = [
    { label: "项目", value: msg.project_name || "全局留言" },
    { label: "联系", value: msg.contact || "未提供" },
    { label: "IP", value: msg.ip || "Unknown" },
    { label: "设备", value: msg.ua ? msg.ua.substring(0, 50) + (msg.ua.length > 50 ? "..." : "") : "Unknown" }
  ];

  items.forEach(it => {
    const el = document.createElement("div");
    el.className = "message-meta-item";
    el.innerHTML = `<span class="message-meta-label">${it.label}</span> <span>${it.value}</span>`;
    metaStack.appendChild(el);
  });

  metaRow.append(metaStack, createStatusPill(msg.status));

  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = msg.content;

  item.append(metaRow, body);

  const replyContainer = document.createElement("div");
  replyContainer.className = "replies-container";
  renderReplies(replyContainer, msg.replies);
  item.appendChild(replyContainer);

  const actions = document.createElement("div");
  actions.className = "message-actions";
  actions.append(
    createActionButton("审核通过", () => updateMessageStatus(msg.id, 1), {
      primary: msg.status !== 1,
      disabled: msg.status === 1,
    }),
    createActionButton("隐藏存档", () => updateMessageStatus(msg.id, 2), {
      disabled: msg.status === 2,
    }),
    createActionButton("设为待审", () => updateMessageStatus(msg.id, 0), {
      disabled: msg.status === 0,
    }),
    createActionButton("回复", () => toggleInlineReply(msg.id), { primary: true }),
    createActionButton("删除", () => deleteMessage(msg.id), { danger: true }),
  );

  item.appendChild(actions);

  // Inline Reply Form Container
  const inlineForm = document.createElement("div");
  inlineForm.id = `reply-form-${msg.id}`;
  inlineForm.className = "reply-inline-form";
  inlineForm.style.display = "none";
  inlineForm.innerHTML = `
    <textarea placeholder="输入回复内容..." class="filter-control"></textarea>
    <div class="flex gap-2">
      <button class="btn primary small btn-confirm-reply">发送回复</button>
      <button class="btn small btn-cancel-reply">取消</button>
    </div>
  `;

  inlineForm.querySelector(".btn-cancel-reply").addEventListener("click", () => {
    inlineForm.style.display = "none";
  });

  inlineForm.querySelector(".btn-confirm-reply").addEventListener("click", async () => {
    const text = inlineForm.querySelector("textarea").value.trim();
    if (!text) {
      showToast("回复内容不能为空", "warning");
      return;
    }
    try {
      await fetchJSON(`${API_BASE}/admin/messages/${msg.id}/replies`, {
        method: "POST",
        body: JSON.stringify({ content: text }),
      });
      showToast("回复成功", "success");
      await loadMessages(state.messageQuery.page);
    } catch (err) {
      showToast(`回复失败：${err.message}`, "error");
    }
  });

  item.appendChild(inlineForm);

  return item;
}

function toggleInlineReply(id) {
  const form = document.getElementById(`reply-form-${id}`);
  if (!form) return;
  const isHidden = form.style.display === "none";
  // Close others? (Optional)
  if (isHidden) {
    form.style.display = "grid";
    form.querySelector("textarea").focus();
  } else {
    form.style.display = "none";
  }
}

async function loadMessages(page = state.messageQuery.page) {
  if (!adminMessageList) return;
  adminMessageList.innerHTML = "";
  adminMessageList.appendChild(createStatusCard("正在加载来信", "稍等一下，留言列表马上就到。"));

  try {
    state.messageQuery.page = page;
    const query = buildQueryParams({
      page: state.messageQuery.page,
      limit: state.messageQuery.limit,
      q: state.messageQuery.q,
      status: state.messageQuery.status,
    });
    const data = await fetchJSON(`${API_BASE}/admin/messages?${query}`);
    state.messages = data.data || [];
    adminMessageList.innerHTML = "";

    if (!state.messages.length) {
      adminMessageList.appendChild(createStatusCard("还没有来信", "当前没有可处理的留言，稍后可以再来看看。"));
      if (messagePagination) messagePagination.innerHTML = "";
      return;
    }

    state.messages.forEach((msg, index) => {
      adminMessageList.appendChild(renderAdminMessage(msg, index));
    });

    if (messagePagination) {
      renderPagination({
        container: messagePagination,
        total: data.total || state.messages.length,
        current: data.page || state.messageQuery.page,
        limit: data.limit || state.messageQuery.limit,
        onPageChange: loadMessages,
      });
    }
  } catch (err) {
    if (isAuthError(err)) throw err;
    adminMessageList.innerHTML = "";
    adminMessageList.appendChild(createStatusCard("来信加载失败", err.message));
  }
}

function syncProjectForm(project) {
  if (!projectForm || !contentHtml) return;
  projectForm.id.value = project.id;
  projectForm.name.value = project.name || "";
  projectForm.summary.value = project.summary || "";
  projectForm.cover_url.value = project.cover_url || "";
  projectForm.video_url.value = project.video_url || "";
  projectForm.external_url.value = project.external_url || "";
  projectForm.tags.value = project.tags || "";
  projectForm.sort_order.value = project.sort_order || 0;
  projectForm.is_public.value = project.is_public ? "1" : "0";
  if (mdeEditor) mdeEditor.value(project.content_html || "");
  contentHtml.value = project.content_html || "";
  if (coverUrlInput) coverUrlInput.dispatchEvent(new Event("input"));
  if (videoUrlInput) videoUrlInput.dispatchEvent(new Event("input"));
  renderUploadedMediaList();
  renderMediaPreview();
}

function renderProject(project, index = 0) {
  const item = document.createElement("div");
  item.className = "message stagger-item";
  item.style.setProperty("--stagger-index", String(index));

  const metaRow = document.createElement("div");
  metaRow.className = "meta-row";

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${project.id}、${project.name} · ${project.view_count || 0} 次浏览`;

  const status = document.createElement("span");
  status.className = `pill status-${project.is_public ? 1 : 2}`;
  status.textContent = project.is_public ? "公开" : "隐藏";
  metaRow.append(meta, status);

  const summary = document.createElement("div");
  summary.textContent = project.summary || "暂无简介";

  const tags = renderTagList(splitTags(project.tags));

  const actions = document.createElement("div");
  actions.className = "message-actions";
  actions.append(
    createActionButton("编辑", () => {
      syncProjectForm(project);
      const anchor = document.getElementById("projectFormAnchor");
      if (anchor) {
        anchor.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      projectForm?.name?.focus?.();
      showToast("作品已载入编辑表单", "info");
    }, { primary: true }),
    createActionButton("删除", () => deleteProject(project.id), { danger: true }),
  );

  item.append(metaRow, summary);
  if (tags) item.appendChild(tags);
  item.appendChild(actions);
  return item;
}

async function loadProjects(page = state.projectQuery.page) {
  if (!projectList) return;
  projectList.innerHTML = "";
  projectList.appendChild(createStatusCard("正在加载作品", "作品列表正在准备中，请稍候。"));

  try {
    state.projectQuery.page = page;
    const query = buildQueryParams({
      page: state.projectQuery.page,
      limit: state.projectQuery.limit,
      q: state.projectQuery.q,
      tag: state.projectQuery.tag,
      is_public: state.projectQuery.is_public,
    });
    const data = await fetchJSON(`${API_BASE}/admin/projects?${query}`);
    state.projects = data.data || [];
    projectList.innerHTML = "";

    if (!state.projects.length) {
      projectList.appendChild(createStatusCard("还没有作品", "可以先在右侧新建第一条作品档案。"));
      if (projectPagination) projectPagination.innerHTML = "";
      return;
    }

    state.projects.forEach((project, index) => {
      projectList.appendChild(renderProject(project, index));
    });

    if (projectPagination) {
      renderPagination({
        container: projectPagination,
        total: data.total || state.projects.length,
        current: data.page || state.projectQuery.page,
        limit: data.limit || state.projectQuery.limit,
        onPageChange: loadProjects,
      });
    }
  } catch (err) {
    if (isAuthError(err)) throw err;
    projectList.innerHTML = "";
    projectList.appendChild(createStatusCard("作品加载失败", err.message));
  }
}

async function loadStats() {
  try {
    const stats = await fetchJSON(`${API_BASE}/admin/stats`);
    if (statsProjects) statsProjects.textContent = stats.total_projects;
    if (statsMessages) statsMessages.textContent = stats.total_messages;
    if (statsPending) statsPending.textContent = stats.pending_messages;
    if (statsToday) statsToday.textContent = stats.today_messages;
    if (statsViews) statsViews.textContent = stats.total_views;
    state.statsLoaded = true;
  } catch (err) {
    if (!isAuthError(err)) {
      console.error("加载统计失败：", err);
    }
    throw err;
  }
}

async function loadAdminData() {
  try {
    if (adminPanel) adminPanel.hidden = true;
    
    // 异步加载所有面板数据，如果某一项失败不应阻止显示面板
    Promise.allSettled([
      loadStats(),
      loadMessages(state.messageQuery.page),
      loadProjects(state.projectQuery.page)
    ]).then((results) => {
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        console.warn(`${failures.length} 个模块加载失败，但控制台将继续显示。`);
      }
    });

    setLoggedIn(true);
    showTab("dashboard");
    initEditor();
  } catch (err) {
    if (isAuthError(err)) {
      setLoggedIn(false);
      return;
    }
    showToast(`初始化控制台失败：${err.message}`, "error");
  }
}

async function checkSession() {
  try {
    const data = await fetchJSON(`${API_BASE}/admin/session`);
    syncUploadLimit(data);
    if (data?.logged_in) {
      await loadAdminData();
      return;
    }
  } catch (err) {
  }
  setLoggedIn(false);
}

function initEditor() {
  if (!contentHtml || mdeEditor) return;
  mdeEditor = new EasyMDE({
    element: contentHtml,
    spellChecker: false,
    autoDownloadFontAwesome: false,
    uploadImage: true,
    imageUploadFunction: async (file, onSuccess, onError) => {
      try {
        const data = await uploadFile(file);
        onSuccess(data.url);
      } catch (err) {
        onError(err.message);
      }
    }
  });
}

async function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    if (isFileTooLarge(file)) {
      reject(new Error(`文件超过 ${formatUploadLimitHint()} 上传上限`));
      return;
    }

    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);

    xhr.open("POST", `${API_BASE}/admin/uploads`, true);
    xhr.withCredentials = true;

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        onProgress(Math.floor((event.loaded / event.total) * 100));
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (err) {
          reject(new Error("响应解析失败"));
        }
        return;
      }

      try {
        const data = JSON.parse(xhr.responseText);
        reject(new Error(data.error || "上传失败"));
      } catch (err) {
        reject(new Error("上传失败"));
      }
    };

    xhr.onerror = () => reject(new Error(`网络请求失败，可能是文件超过 ${formatUploadLimitHint()} 或连接被重置`));
    xhr.send(formData);
  });
}

function resetProjectForm() {
  if (!projectForm || !contentHtml) return;
  projectForm.reset();
  if (mdeEditor) mdeEditor.value("");
  contentHtml.value = "";
  renderUploadedMediaList();
  renderMediaPreview();
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(loginForm).entries());

    try {
      const data = await fetchJSON(`${API_BASE}/admin/login`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      syncUploadLimit(data);
      showToast("登录成功", "success");
      setLoggedIn(true);
      await loadAdminData();
    } catch (err) {
      showToast(`登录失败：${err.message}`, "error");
    }
  });
}

// replyForm has been removed in favor of inline replies

const resetFormBtn = document.getElementById("resetFormBtn");
if (resetFormBtn) {
  resetFormBtn.addEventListener("click", () => {
    resetProjectForm();
    showToast("表单已重置，可以开始创建新作品", "info");
  });
}

if (projectForm) {
  projectForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = Object.fromEntries(new FormData(projectForm).entries());
    const id = String(payload.id || "").trim();
    if (mdeEditor) {
      contentHtml.value = mdeEditor.value().trim();
    }

    const requestBody = {
      name: String(payload.name || "").trim(),
      summary: String(payload.summary || "").trim(),
      cover_url: String(payload.cover_url || "").trim(),
      video_url: String(payload.video_url || "").trim(),
      external_url: String(payload.external_url || "").trim(),
      tags: String(payload.tags || "").trim(),
      sort_order: Number(payload.sort_order || 0),
      is_public: payload.is_public === "1",
      content_html: contentHtml ? contentHtml.value : "",
    };

    try {
      if (id) {
        await fetchJSON(`${API_BASE}/admin/projects/${id}`, {
          method: "PUT",
          body: JSON.stringify(requestBody),
        });
        showToast("作品更新成功", "success");
      } else {
        await fetchJSON(`${API_BASE}/admin/projects`, {
          method: "POST",
          body: JSON.stringify(requestBody),
        });
        showToast("作品创建成功", "success");
      }

      resetProjectForm();
      await loadProjects(state.projectQuery.page);
    } catch (err) {
      showToast(`提交失败：${err.message}`, "error");
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await fetchJSON(`${API_BASE}/admin/logout`, { method: "POST" });
      showToast("已安全退出", "info");
    } catch (err) {
    }
    setLoggedIn(false);
  });
}

if (passwordForm) {
  // 密码可见性切换
  passwordForm.querySelectorAll(".password-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.parentElement.querySelector("input");
      const eyeOpen = btn.querySelector(".eye-open");
      const eyeClosed = btn.querySelector(".eye-closed");

      if (input.type === "password") {
        input.type = "text";
        eyeOpen.classList.add("hidden");
        eyeClosed.classList.remove("hidden");
      } else {
        input.type = "password";
        eyeOpen.classList.remove("hidden");
        eyeClosed.classList.add("hidden");
      }
    });
  });

  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(passwordForm));

    if (data.new_password !== data.confirm_password) {
      showToast("两次输入的新密码不一致", "error");
      return;
    }

    try {
      const res = await fetchJSON(`${API_BASE}/admin/password`, {
        method: "POST",
        body: JSON.stringify({
          old_password: data.old_password,
          new_password: data.new_password,
        }),
      });
      showToast(res.message || "密码修改成功", "success");
      passwordForm.reset();
      // 重置密码框类型
      passwordForm.querySelectorAll("input[type='text']").forEach(input => input.type = 'password');
      passwordForm.querySelectorAll(".eye-open").forEach(ic => ic.classList.remove("hidden"));
      passwordForm.querySelectorAll(".eye-closed").forEach(ic => ic.classList.add("hidden"));
    } catch (err) {
      console.error("修改密码失败:", err);
      showToast(err.message || "修改密码失败", "error");
    }
  });
}

if (coverUploadBtn && coverUploadInput) {
  coverUploadBtn.addEventListener("click", () => coverUploadInput.click());
  coverUploadInput.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length || !projectForm) return;

    const { accepted, rejected } = splitFilesByUploadLimit(files);
    notifyRejectedFiles(rejected, "图片");

    const successUrls = [];
    const failed = rejected.map(buildTooLargeMessage);
    if (!accepted.length) {
      coverUploadInput.value = "";
      return;
    }
    showToast(`正在上传 ${accepted.length} 张项目图片...`, "info");

    for (const file of accepted) {
      try {
        const data = await uploadFile(file);
        if (data?.url) successUrls.push(data.url);
      } catch (err) {
        failed.push(`${file.name}: ${err.message}`);
      }
    }

    appendMediaUrls(projectForm.cover_url, successUrls);
    if (coverUrlInput) coverUrlInput.dispatchEvent(new Event("input"));
    renderUploadedMediaList();

    if (successUrls.length && !failed.length) {
      showToast(`项目图片上传完成：${successUrls.length} 张`, "success");
    } else if (successUrls.length) {
      showToast(`已上传 ${successUrls.length} 张，失败 ${failed.length} 张`, "info");
      console.warn("项目图片上传失败详情：", failed);
    } else {
      showToast("图片上传失败，请重试", "error");
      if (failed.length) console.error("项目图片上传失败详情：", failed);
    }

    coverUploadInput.value = "";
  });
}

if (videoUploadBtn && videoUploadInput) {
  videoUploadBtn.addEventListener("click", () => videoUploadInput.click());
  videoUploadInput.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length || !projectForm) return;

    const { accepted, rejected } = splitFilesByUploadLimit(files);
    notifyRejectedFiles(rejected, "视频");

    const progContainer = document.getElementById("videoProgressContainer");
    const progressBar = document.getElementById("videoProgressBar");
    if (progContainer) progContainer.style.display = "block";
    if (progressBar) progressBar.style.width = "0%";

    const successUrls = [];
    const failed = rejected.map(buildTooLargeMessage);
    if (!accepted.length) {
      videoUploadInput.value = "";
      if (progContainer) progContainer.style.display = "none";
      return;
    }
    showToast(`正在上传 ${accepted.length} 个视频...`, "info");

    try {
      for (let i = 0; i < accepted.length; i += 1) {
        const file = accepted[i];
        try {
          const data = await uploadFile(file, (percent) => {
            if (!progressBar) return;
            const overall = ((i + percent / 100) / accepted.length) * 100;
            progressBar.style.width = `${Math.round(overall)}%`;
          });
          if (data?.url) successUrls.push(data.url);
        } catch (err) {
          failed.push(`${file.name}: ${err.message}`);
        } finally {
          if (progressBar) {
            const completed = ((i + 1) / accepted.length) * 100;
            progressBar.style.width = `${Math.round(completed)}%`;
          }
        }
      }

      appendMediaUrls(projectForm.video_url, successUrls);
      if (videoUrlInput) videoUrlInput.dispatchEvent(new Event("input"));
      renderUploadedMediaList();

      if (successUrls.length && !failed.length) {
        showToast(`视频上传完成：${successUrls.length} 个`, "success");
      } else if (successUrls.length) {
        showToast(`已上传 ${successUrls.length} 个，失败 ${failed.length} 个`, "info");
        console.warn("视频上传失败详情：", failed);
      } else {
        showToast("视频上传失败，请重试", "error");
        if (failed.length) console.error("视频上传失败详情：", failed);
      }
    } finally {
      videoUploadInput.value = "";
      if (progContainer) {
        setTimeout(() => {
          progContainer.style.display = "none";
          if (progressBar) progressBar.style.width = "0%";
        }, 1200);
      }
    }
  });
}

if (coverUrlInput) {
  coverUrlInput.addEventListener("input", () => {
    renderUploadedMediaList();
    renderMediaPreview();
  });
}

if (videoUrlInput) {
  videoUrlInput.addEventListener("input", () => {
    renderUploadedMediaList();
    renderMediaPreview();
  });
}

if (messageSearchBtn) {
  messageSearchBtn.addEventListener("click", applyMessageFilters);
}

if (messageResetBtn) {
  messageResetBtn.addEventListener("click", () => {
    if (messageSearch) messageSearch.value = "";
    if (messageStatusFilter) messageStatusFilter.value = "";
    state.messageQuery.q = "";
    state.messageQuery.status = "";
    loadMessages(1);
  });
}

if (projectSearchBtn) {
  projectSearchBtn.addEventListener("click", applyProjectFilters);
}

if (projectResetBtn) {
  projectResetBtn.addEventListener("click", () => {
    if (projectSearch) projectSearch.value = "";
    if (projectTagFilter) projectTagFilter.value = "";
    if (projectPublicFilter) projectPublicFilter.value = "";
    state.projectQuery.q = "";
    state.projectQuery.tag = "";
    state.projectQuery.is_public = "";
    loadProjects(1);
  });
}

bindEnterSearch(messageSearch, applyMessageFilters);
bindEnterSearch(projectSearch, applyProjectFilters);
bindEnterSearch(projectTagFilter, applyProjectFilters);

if (messageStatusFilter) {
  messageStatusFilter.addEventListener("change", applyMessageFilters);
}

if (projectPublicFilter) {
  projectPublicFilter.addEventListener("change", applyProjectFilters);
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => showTab(tab.dataset.tab));
});

if (coverPickerBtn) {
  coverPickerBtn.onclick = () => showGlobalPicker(coverUrlInput);
}
if (videoPickerBtn) {
  videoPickerBtn.onclick = () => showGlobalPicker(videoUrlInput);
}

checkSession();
renderUploadedMediaList();
renderMediaPreview();

setInterval(async () => {
  if (adminPanel?.hidden) return;
  try {
    await fetchJSON(`${API_BASE}/admin/stats`);
  } catch (err) {
    if (isAuthError(err)) {
      setLoggedIn(false);
      showToast("登录已过期或服务已重启，请重新登录。", "warning");
    }
  }
}, 5 * 60 * 1000);
