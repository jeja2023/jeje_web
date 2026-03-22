// 留言板脚本 / Messages Script
import { API_BASE, fetchJSON, formatDate, showToast, renderPagination, showLoading, hideLoading, renderEmpty, initFooter } from "/globals/global.js";

const list = document.getElementById("messageList");
const pagination = document.getElementById("messagePagination");
const form = document.getElementById("messageForm");
const captchaQuestion = document.getElementById("captchaQuestion");
const captchaRefresh = document.getElementById("captchaRefresh");
const captchaId = document.getElementById("captchaId");

const state = {
  page: 1,
  limit: 10,
};

let captchaLoading = false;

function renderMessage(msg, index) {
  const item = document.createElement("div");
  item.className = "message stagger-item";
  item.style.setProperty("--stagger-index", String(index));

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.innerHTML = `
    <span class="nickname">${msg.nickname}</span>
    <span class="dot">·</span>
    <span class="time">${formatDate(msg.created_at)}</span>
  `;

  const content = document.createElement("div");
  content.className = "content";
  content.textContent = msg.content;

  item.append(meta, content);

  if (msg.replies && msg.replies.length) {
    msg.replies.forEach((reply) => {
      const replyEl = document.createElement("div");
      replyEl.className = "reply";
      replyEl.innerHTML = `
        <div class="reply-header">
          <span>管理员回复</span>
        </div>
        <div class="reply-content">${reply.content}</div>
      `;
      item.appendChild(replyEl);
    });
  }

  return item;
}

async function loadMessages() {
  showLoading(list);
  try {
    const data = await fetchJSON(`${API_BASE}/messages?page=${state.page}&limit=${state.limit}`);
    const messages = data.data || [];
    hideLoading(list);
    list.innerHTML = "";

    if (!messages.length) {
      renderEmpty(list, "目前还没有留言，来做第一个留言的人吧？");
      return;
    }

    messages.forEach((msg, index) => {
      list.appendChild(renderMessage(msg, index));
    });

    renderPagination({
      container: pagination,
      total: data.total || 0,
      current: state.page,
      limit: state.limit,
      onPageChange: (newPage) => {
        state.page = newPage;
        loadMessages();
        window.scrollTo({ top: 0, behavior: "smooth" });
      },
    });
  } catch (err) {
    hideLoading(list);
    list.innerHTML = `<div class="card p-4 text-center text-error">加载失败：${err.message}</div>`;
  }
}

async function loadCaptcha() {
  if (captchaLoading) return;
  captchaLoading = true;
  captchaQuestion.style.opacity = "0.5";
  try {
    const data = await fetchJSON(`${API_BASE}/captcha`);
    captchaQuestion.textContent = data.question || "请完成验证";
    captchaId.value = data.id || "";
  } catch (err) {
    captchaQuestion.textContent = "验证码加载失败";
    captchaId.value = "";
  } finally {
    captchaLoading = false;
    captchaQuestion.style.opacity = "1";
  }
}

if (captchaRefresh) {
  captchaRefresh.addEventListener("click", loadCaptcha);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const btn = form.querySelector('button[type="submit"]');

  if (!captchaId.value) {
    showToast("验证码未加载，请重试", "warning");
    await loadCaptcha();
    return;
  }

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    btn.disabled = true;
    btn.innerHTML = "<span>发送中...</span>";

    await fetchJSON(`${API_BASE}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    showToast("提交成功，感谢您的留言", "success");
    form.reset();
    await loadCaptcha();
  } catch (err) {
    showToast(`提交失败：${err.message}`, "error");
    await loadCaptcha();
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <span>发送留言</span>
      <i class="icon-send"></i>
    `;
  }
});

loadMessages();
loadCaptcha();
initFooter();
