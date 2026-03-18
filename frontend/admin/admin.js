// 管理后台脚本 / Admin Script
import { API_BASE, fetchJSON, formatDate, showToast, showModal, renderPagination } from "/globals/global.js";

const loginCard = document.getElementById("loginCard");
const loginForm = document.getElementById("loginForm");
const adminPanel = document.getElementById("adminPanel");
const tabs = document.querySelectorAll(".tab");
const tabMessages = document.getElementById("tab-messages");
const tabProjects = document.getElementById("tab-projects");
const adminMessageList = document.getElementById("adminMessageList");
const messageSearch = document.getElementById("messageSearch");
const messageStatusFilter = document.getElementById("messageStatusFilter");
const messageSearchBtn = document.getElementById("messageSearchBtn");
const messageResetBtn = document.getElementById("messageResetBtn");
const messagePagination = document.getElementById("messagePagination");
const replyForm = document.getElementById("replyForm");
const projectList = document.getElementById("projectList");
const projectSearch = document.getElementById("projectSearch");
const projectTagFilter = document.getElementById("projectTagFilter");
const projectPublicFilter = document.getElementById("projectPublicFilter");
const projectSearchBtn = document.getElementById("projectSearchBtn");
const projectResetBtn = document.getElementById("projectResetBtn");
const projectPagination = document.getElementById("projectPagination");
const projectForm = document.getElementById("projectForm");
const logoutBtn = document.getElementById("logoutBtn");
const editor = document.getElementById("projectEditor");
const contentHtml = document.getElementById("contentHtml");
const toolbar = document.querySelector(".editor-toolbar");
const imageUploadBtn = document.getElementById("imageUploadBtn");
const imageUploadInput = document.getElementById("imageUploadInput");
const statsProjects = document.getElementById("stats-projects");
const statsMessages = document.getElementById("stats-messages");
const statsPending = document.getElementById("stats-pending");
const statsToday = document.getElementById("stats-today");
const statsViews = document.getElementById("stats-views");
const tabDashboard = document.getElementById("tab-dashboard");

const state = {
  messages: [],
  projects: [],
  statsLoaded: false,
  messageQuery: { page: 1, limit: 20, q: "", status: "" },
  projectQuery: { page: 1, limit: 20, q: "", tag: "", is_public: "" },
};

let savedRange = null;

function isAuthError(err) {
  if (!err) return false;
  if (err.status === 401 || err.status === 403) return true;
  return /unauthorized|session|未登录|会话无效|登录已过期|未授权/i.test(err.message);
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

function setLoggedIn(loggedIn) {
  loginCard.style.display = loggedIn ? "none" : "block";
  adminPanel.style.display = loggedIn ? "block" : "none";
  if (!loggedIn) {
    state.statsLoaded = false;
  }
}

function showTab(name) {
  tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === name);
  });
  tabDashboard.style.display = name === "dashboard" ? "block" : "none";
  tabMessages.style.display = name === "messages" ? "block" : "none";
  tabProjects.style.display = name === "projects" ? "block" : "none";
  
  if (name === "dashboard") loadStats();
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
  if (options.danger) {
    btn.classList.add("danger");
  }
  if (options.disabled) {
    btn.disabled = true;
  }
  btn.addEventListener("click", onClick);
  return btn;
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
    showToast(`更新失败: ${err.message}`, "error");
  }
}

async function deleteMessage(id) {
  showModal({
    title: "确认删除",
    content: "确定要删除这条留言吗？此操作不可撤销。",
    onConfirm: async () => {
      try {
        await fetchJSON(`${API_BASE}/admin/messages/${id}`, {
          method: "DELETE",
        });
        showToast("留言已删除", "success");
        await loadMessages(state.messageQuery.page);
      } catch (err) {
        showToast(`删除失败: ${err.message}`, "error");
      }
    }
  });
}

async function deleteProject(id) {
  showModal({
    title: "确认删除",
    content: "确定要删除这个项目吗？",
    onConfirm: async () => {
      try {
        await fetchJSON(`${API_BASE}/admin/projects/${id}`, {
          method: "DELETE",
        });
        showToast("项目已删除", "success");
        await loadProjects(state.projectQuery.page);
      } catch (err) {
        showToast(`删除失败: ${err.message}`, "error");
      }
    }
  });
}

function renderReplies(container, replies) {
  if (!replies || !replies.length) return;
  replies.forEach((reply) => {
    const replyEl = document.createElement("div");
    replyEl.className = "reply";
    const strong = document.createElement("strong");
    strong.textContent = "管理员回复：";
    replyEl.append(strong, document.createTextNode(` ${reply.content}`));
    container.appendChild(replyEl);
  });
}

function renderAdminMessage(msg) {
  const item = document.createElement("div");
  item.className = "message";

  const metaRow = document.createElement("div");
  metaRow.className = "meta-row";

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `#${msg.id} ${msg.nickname} · ${formatDate(msg.created_at)}`;

  metaRow.append(meta, createStatusPill(msg.status));

  const content = document.createElement("div");
  content.textContent = msg.content;

  item.append(metaRow, content);

  if (msg.contact) {
    const contact = document.createElement("div");
    contact.className = "notice";
    contact.textContent = `联系方式：${msg.contact}`;
    item.appendChild(contact);
  }

  renderReplies(item, msg.replies);

  const actions = document.createElement("div");
  actions.className = "message-actions";
  actions.append(
    createActionButton("审核通过", () => updateMessageStatus(msg.id, 1), {
      primary: msg.status !== 1,
      disabled: msg.status === 1,
    }),
    createActionButton("隐藏", () => updateMessageStatus(msg.id, 2), {
      disabled: msg.status === 2,
    }),
    createActionButton("设为待审", () => updateMessageStatus(msg.id, 0), {
      disabled: msg.status === 0,
    }),
    createActionButton("回复此留言", () => {
      replyForm.messageId.value = msg.id;
      replyForm.content.focus();
    }),
    createActionButton("删除", () => deleteMessage(msg.id), { danger: true })
  );

  item.appendChild(actions);
  return item;
}

async function loadMessages(page = state.messageQuery.page) {
  adminMessageList.textContent = "加载中...";
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
      adminMessageList.innerHTML = `<div class="message">暂无留言。</div>`;
      if (messagePagination) messagePagination.innerHTML = "";
      return;
    }
    state.messages.forEach((msg) => {
      adminMessageList.appendChild(renderAdminMessage(msg));
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
    if (isAuthError(err)) {
      throw err;
    }
    adminMessageList.innerHTML = `<div class="message">加载失败：${err.message}</div>`;
  }
}

function renderProject(project) {
  const item = document.createElement("div");
  item.className = "message";

  const metaRow = document.createElement("div");
  metaRow.className = "meta-row";

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `#${project.id} ${project.name} · ${project.view_count || 0} 次浏览`;

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
      projectForm.id.value = project.id;
      projectForm.name.value = project.name || "";
      projectForm.summary.value = project.summary || "";
      projectForm.cover_url.value = project.cover_url || "";
      projectForm.video_url.value = project.video_url || "";
      projectForm.external_url.value = project.external_url || "";
      projectForm.tags.value = project.tags || "";
      projectForm.sort_order.value = project.sort_order || 0;
      projectForm.is_public.value = project.is_public ? "1" : "0";
      editor.innerHTML = project.content_html || "";
      contentHtml.value = project.content_html || "";
      projectForm.name.focus();
      // 触发封面预览
      projectForm.cover_url.dispatchEvent(new Event("input"));
      showToast("项目已加载到编辑表单", "info");
    }),
    createActionButton("删除", () => deleteProject(project.id), { danger: true })
  );

  if (tags) {
    item.append(metaRow, summary, tags, actions);
  } else {
    item.append(metaRow, summary, actions);
  }
  return item;
}

async function loadProjects(page = state.projectQuery.page) {
  projectList.textContent = "加载中...";
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
      projectList.innerHTML = `<div class="message">暂无项目。</div>`;
      if (projectPagination) projectPagination.innerHTML = "";
      return;
    }
    state.projects.forEach((project) => {
      projectList.appendChild(renderProject(project));
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
    if (isAuthError(err)) {
      throw err;
    }
    projectList.innerHTML = `<div class="message">加载失败：${err.message}</div>`;
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
      console.error("加载统计数据失败:", err);
    }
    throw err;
  }
}

async function loadAdminData() {
  try {
    adminPanel.style.display = "none";
    await loadStats();
    await loadMessages(state.messageQuery.page);
    await loadProjects(state.projectQuery.page);
    setLoggedIn(true);
    showTab("dashboard");
  } catch (err) {
    if (isAuthError(err)) {
      setLoggedIn(false);
      return;
    }
    showToast(`加载失败：${err.message}`, "error");
  }
}

async function checkSession() {
  try {
    const data = await fetchJSON(`${API_BASE}/admin/session`);
    if (data && data.logged_in) {
      await loadAdminData();
      return;
    }
  } catch (err) {
  }
  setLoggedIn(false);
}

function saveSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  savedRange = selection.getRangeAt(0);
}

function restoreSelection() {
  if (!savedRange) return;
  if (editor) editor.focus();
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedRange);
}

function runCommand(command) {
  restoreSelection();
  if (command === "h2") {
    document.execCommand("formatBlock", false, "h2");
    return;
  }
  if (command === "ul") {
    document.execCommand("insertUnorderedList");
    return;
  }
  if (command === "ol") {
    document.execCommand("insertOrderedList");
    return;
  }
  if (command === "link") {
    const url = prompt("请输入链接地址");
    if (!url) return;
    document.execCommand("createLink", false, url);
    return;
  }
  document.execCommand(command);
}

async function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);

    xhr.open("POST", `${API_BASE}/admin/uploads`, true);
    xhr.withCredentials = true;

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.floor((e.loaded / e.total) * 100));
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (e) {
          reject(new Error("响应解析错误"));
        }
      } else {
        let message = "上传失败";
        try {
          const data = JSON.parse(xhr.responseText);
          message = data.error || message;
        } catch (e) {}
        reject(new Error(message));
      }
    };

    xhr.onerror = () => reject(new Error("网络请求失败"));
    xhr.send(formData);
  });
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(loginForm).entries());
  try {
    await fetchJSON(`${API_BASE}/admin/login`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    showToast("登录成功", "success");
    setLoggedIn(true);
    await loadAdminData();
  } catch (err) {
    showToast(`登录失败：${err.message}`, "error");
  }
});

replyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(replyForm).entries());
  const messageId = payload.messageId?.trim();
  if (!messageId) {
    showToast("请填写留言 ID", "warning");
    return;
  }
  try {
    await fetchJSON(`${API_BASE}/admin/messages/${messageId}/replies`, {
      method: "POST",
      body: JSON.stringify({ content: payload.content }),
    });
    showToast("回复成功", "success");
    replyForm.reset();
    await loadMessages(state.messageQuery.page);
  } catch (err) {
    showToast(`回复失败：${err.message}`, "error");
  }
});

projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = Object.fromEntries(new FormData(projectForm).entries());
  const id = payload.id?.trim();
  contentHtml.value = editor.innerHTML.trim();

  const requestBody = {
    name: payload.name?.trim(),
    summary: payload.summary?.trim(),
    cover_url: payload.cover_url?.trim(),
    video_url: payload.video_url?.trim(),
    external_url: payload.external_url?.trim(),
    tags: payload.tags?.trim(),
    sort_order: Number(payload.sort_order || 0),
    is_public: payload.is_public === "1",
    content_html: contentHtml.value,
  };

  try {
    if (id) {
      await fetchJSON(`${API_BASE}/admin/projects/${id}`, {
        method: "PUT",
        body: JSON.stringify(requestBody),
      });
      showToast("项目更新成功", "success");
    } else {
      await fetchJSON(`${API_BASE}/admin/projects`, {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
      showToast("项目创建成功", "success");
    }
    projectForm.reset();
    editor.innerHTML = "";
    contentHtml.value = "";
    document.getElementById("coverPreview")?.style.setProperty("display", "none");
    await loadProjects(state.projectQuery.page);
  } catch (err) {
    showToast(`提交失败：${err.message}`, "error");
  }
});

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

if (editor) {
  editor.addEventListener("mouseup", saveSelection);
  editor.addEventListener("keyup", saveSelection);
}

if (toolbar) {
  toolbar.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const command = target.dataset.cmd;
    if (!command) return;
    event.preventDefault();
    runCommand(command);
  });
}

if (imageUploadBtn && imageUploadInput) {
  imageUploadBtn.addEventListener("click", () => imageUploadInput.click());
  imageUploadInput.addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    showToast("图片上传中...", "info");
    try {
      const data = await uploadFile(file);
      restoreSelection();
      document.execCommand("insertImage", false, data.url);
      showToast("图片已插入编辑器", "success");
    } catch (err) {
      showToast(`图片上传失败：${err.message}`, "error");
    } finally {
      imageUploadInput.value = "";
    }
  });
}

// 封面与视频上传处理 / Cover and Video Uploads
const coverUploadBtn = document.getElementById("coverUploadBtn");
const coverUploadInput = document.getElementById("coverUploadInput");
const videoUploadBtn = document.getElementById("videoUploadBtn");
const videoUploadInput = document.getElementById("videoUploadInput");

if (coverUploadBtn && coverUploadInput) {
  coverUploadBtn.addEventListener("click", () => coverUploadInput.click());
  coverUploadInput.addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    showToast("封面图片上传中...", "info");
    try {
      const data = await uploadFile(file);
      projectForm.cover_url.value = data.url;
      projectForm.cover_url.dispatchEvent(new Event("input"));
      showToast("封面图片已上传", "success");
    } catch (err) {
      showToast(`封面上传失败：${err.message}`, "error");
    } finally {
      coverUploadInput.value = "";
    }
  });
}

if (videoUploadBtn && videoUploadInput) {
  videoUploadBtn.addEventListener("click", () => videoUploadInput.click());
  videoUploadInput.addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    
    const progContainer = document.getElementById("videoProgressContainer");
    const progressBar = document.getElementById("videoProgressBar");
    
    if (progContainer) {
      progContainer.style.display = "block";
      if (progressBar) progressBar.style.width = "0%";
    }
    
    showToast("视频上传中...", "info");
    try {
      const data = await uploadFile(file, (percent) => {
        if (progressBar) progressBar.style.width = percent + "%";
      });
      projectForm.video_url.value = data.url;
      showToast("演示视频已上传", "success");
    } catch (err) {
      showToast(`视频上传失败：${err.message}`, "error");
    } finally {
      videoUploadInput.value = "";
      if (progContainer) {
        setTimeout(() => {
          progContainer.style.display = "none";
          if (progressBar) progressBar.style.width = "0%";
        }, 1500);
      }
    }
  });
}

const coverUrlInput = projectForm.querySelector('input[name="cover_url"]');
if (coverUrlInput) {
  coverUrlInput.addEventListener("input", (e) => {
    const url = e.target.value.trim();
    let preview = document.getElementById("coverPreview");
    if (!preview) {
      preview = document.createElement("img");
      preview.id = "coverPreview";
      preview.style.cssText = "width:100%; height:120px; object-fit:cover; border-radius:12px; margin-top:10px; border:1px solid var(--line);";
      coverUrlInput.parentElement.parentElement.appendChild(preview);
    }
    preview.src = url || "";
    preview.style.display = url ? "block" : "none";
  });
}

if (messageSearchBtn) {
  messageSearchBtn.addEventListener("click", () => {
    state.messageQuery.q = messageSearch ? messageSearch.value.trim() : "";
    state.messageQuery.status = messageStatusFilter ? messageStatusFilter.value : "";
    loadMessages(1);
  });
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
  projectSearchBtn.addEventListener("click", () => {
    state.projectQuery.q = projectSearch ? projectSearch.value.trim() : "";
    state.projectQuery.tag = projectTagFilter ? projectTagFilter.value.trim() : "";
    state.projectQuery.is_public = projectPublicFilter ? projectPublicFilter.value : "";
    loadProjects(1);
  });
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

tabs.forEach((tab) => {
  tab.addEventListener("click", () => showTab(tab.dataset.tab));
});

checkSession();

setInterval(async () => {
  if (adminPanel.style.display !== "none") {
    try {
      await fetchJSON(`${API_BASE}/admin/stats`);
    } catch (err) {
      if (isAuthError(err)) {
        setLoggedIn(false);
        showToast("登录已过期或服务器已重启，请重新登录", "warning");
      }
    }
  }
}, 5 * 60 * 1000);
