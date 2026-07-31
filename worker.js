// ============================================================
// ربات ساده هوش مصنوعی بله (Bale) — Cloudflare Worker
// فقط از Workers AI خود کلادفلر استفاده می‌کنه (بدون Gemini/Groq)
//
// متغیرهای محیطی لازم (Settings → Variables and Secrets):
//   BALE_BOT_TOKEN  — توکن ربات (از botfather@ در بله بگیر)
//   WORKER_DOMAIN   — دامنه ورکر، مثلاً hamedai.xxx.workers.dev
//
// Bindings لازم (Settings → Bindings):
//   AI   → Workers AI
//   KV   → یک KV Namespace (برای ذخیره تاریخچه و مدل انتخابی هر کاربر)
//
// بعد از دیپلوی، یک‌بار این آدرس رو باز کن تا webhook ثبت بشه:
//   https://<WORKER_DOMAIN>/setWebhook
// ============================================================

// مدل‌های متنی Workers AI که ربات ازشون استفاده می‌کنه.
// نکته: مدل‌های خانواده GPT-OSS با فرمت «Responses API» جواب میدن
// (ساختار output به‌جای رشته ساده response)، برای همین تابع
// extractText پایین‌تر هر دو فرمت رو پشتیبانی می‌کنه.
const MODELS = [
  { id: 'gpt120',   name: '🟢 GPT-OSS 120B (قوی‌ترین)', model: '@cf/openai/gpt-oss-120b' },
  { id: 'gemma',    name: '🔵 Gemma 4 27B',              model: '@cf/google/gemma-4-26b-a4b-it' },
  { id: 'qwen',     name: '🟣 Qwen3 30B',                model: '@cf/qwen/qwen3-30b-a3b-fp8' },
  { id: 'llama',    name: '🟠 Llama 4 Scout',            model: '@cf/meta/llama-4-scout-17b-16e-instruct' },
  { id: 'deepseek', name: '🔴 DeepSeek R1 (استدلالی)',   model: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b' },
  { id: 'glm',      name: '🟡 GLM-4.7 Flash (کدنویسی)',  model: '@cf/zai-org/glm-4.7-flash' },
];

// دو مدل تصویرسازی، هر دو رایگان و میزبانی خود کلادفلر (بدون نیاز به دسترسی Partner):
// یکی سریع برای استفاده روزمره، یکی با جزئیات بیشتر و کندتر
const IMAGE_MODEL_FAST = '@cf/black-forest-labs/flux-1-schnell';
const IMAGE_MODEL_HQ   = '@cf/stabilityai/stable-diffusion-xl-base-1.0';
const DEFAULT_MODEL_ID = 'qwen'; // پایدارترین و سریع‌ترین مدل به‌عنوان پیش‌فرض
const MAX_HISTORY = 8; // تعداد پیام‌هایی که در حافظه هر کاربر نگه داشته میشه (۴ رفت‌وبرگشت)
const HISTORY_TTL = 60 * 60 * 24 * 7; // یک هفته

function baleApi(token) {
  return `https://tapi.bale.ai/bot${token}`;
}

// ------------------------------------------------------------
// ورودی اصلی Worker
// ------------------------------------------------------------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/setWebhook') {
      return setWebhook(env);
    }

    if (request.method !== 'POST') {
      return new Response(renderStatusPage(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    let update;
    try {
      update = await request.json();
    } catch (err) {
      console.error('Invalid JSON body:', err);
      return new Response('Bad Request', { status: 400 });
    }

    try {
      await handleUpdate(update, env);
    } catch (err) {
      console.error('Error handling update:', err);
    }

    return new Response('OK');
  },
};

async function setWebhook(env) {
  const res = await fetch(`${baleApi(env.BALE_BOT_TOKEN)}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `https://${env.WORKER_DOMAIN}` }),
  });
  const data = await res.json();
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderStatusPage() {
  const modelRows = MODELS.map(
    (m) => `<li><span class="name">${m.name}</span><code>${m.model}</code></li>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ربات هوش مصنوعی بله</title>
<style>
  body {
    font-family: Tahoma, Vazirmatn, sans-serif;
    background: #0f172a;
    color: #e2e8f0;
    margin: 0;
    padding: 40px 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .card {
    background: #1e293b;
    border-radius: 16px;
    padding: 28px;
    max-width: 480px;
    width: 100%;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    margin-bottom: 20px;
  }
  h1 { font-size: 20px; margin-top: 0; }
  h2 { font-size: 16px; color: #94a3b8; margin-bottom: 10px; }
  button {
    background: linear-gradient(135deg, #22c55e, #16a34a);
    color: white;
    border: none;
    padding: 14px 22px;
    font-size: 16px;
    border-radius: 10px;
    cursor: pointer;
    width: 100%;
    font-family: inherit;
    transition: transform 0.1s ease;
  }
  button:hover { transform: translateY(-1px); }
  button:disabled { opacity: 0.6; cursor: default; }
  #result {
    margin-top: 14px;
    font-size: 13px;
    white-space: pre-wrap;
    word-break: break-word;
    background: #0f172a;
    border-radius: 8px;
    padding: 10px;
    display: none;
  }
  ul { list-style: none; padding: 0; margin: 0; }
  li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid #334155;
    font-size: 14px;
  }
  li:last-child { border-bottom: none; }
  .name { color: #e2e8f0; }
  code {
    color: #94a3b8;
    font-size: 11px;
    direction: ltr;
    text-align: left;
  }
  .status { color: #22c55e; font-size: 14px; margin-bottom: 16px; }
</style>
</head>
<body>

<div class="card">
  <div class="status">🟢 ربات فعاله</div>
  <h1>فعال‌سازی Webhook</h1>
  <button id="btn" onclick="setupWebhook()">فعال‌سازی Webhook</button>
  <div id="result"></div>
</div>

<div class="card">
  <h2>🤖 مدل‌های متنی فعال</h2>
  <ul>${modelRows}</ul>
</div>

<div class="card">
  <h2>🖼️ مدل‌های ساخت تصویر فعال</h2>
  <ul>
    <li><span class="name">⚡ سریع (/image)</span><code>${IMAGE_MODEL_FAST}</code></li>
    <li><span class="name">✨ کیفیت بالا (/imagehd)</span><code>${IMAGE_MODEL_HQ}</code></li>
  </ul>
</div>

<script>
async function setupWebhook() {
  const btn = document.getElementById('btn');
  const result = document.getElementById('result');
  btn.disabled = true;
  btn.textContent = 'در حال فعال‌سازی...';
  result.style.display = 'block';
  result.textContent = '...';
  try {
    const res = await fetch('/setWebhook');
    const data = await res.json();
    result.textContent = JSON.stringify(data, null, 2);
    btn.textContent = data.ok ? '✅ فعال شد' : '⚠️ خطا، دوباره امتحان کن';
  } catch (err) {
    result.textContent = 'خطا: ' + err.message;
    btn.textContent = '⚠️ خطا، دوباره امتحان کن';
  }
  btn.disabled = false;
}
</script>

</body>
</html>`;
}

// ------------------------------------------------------------
// پردازش پیام‌های ورودی از بله
// ------------------------------------------------------------
async function handleUpdate(update, env) {
  if (update.callback_query) {
    return handleCallback(update.callback_query, env);
  }
  if (update.message) {
    return handleMessage(update.message, env);
  }
}

async function handleMessage(message, env) {
  const chatId = message.chat.id;
  const text = (message.text || '').trim();

  if (text === '/start') {
    await sendMessage(chatId, 'سلام 👋 من یه ربات هوش مصنوعیم که روی Cloudflare Workers AI اجرا میشم.\nبرای انتخاب مدل از /model استفاده کن و سوالت رو بپرس.\nبرای ساخت تصویر سریع: /image توضیح تصویر\nبرای ساخت تصویر باکیفیت‌تر (کندتر): /imagehd توضیح تصویر', env);
    await sendModelPicker(chatId, env);
    return;
  }

  if (text === '/model') {
    await sendModelPicker(chatId, env);
    return;
  }

  if (text === '/reset') {
    await env.KV.delete(`history:${chatId}`);
    await sendMessage(chatId, '✅ حافظه مکالمه پاک شد.', env);
    return;
  }

  if (text === '/image' || text.startsWith('/image ')) {
    const prompt = text.slice('/image'.length).trim();
    if (!prompt) {
      await sendMessage(chatId, 'بعد از دستور /image توضیح تصویر رو بنویس.\nمثال: /image یک گربه فضانورد روی ماه\n\nبرای کیفیت بالاتر (کندتر) از /imagehd استفاده کن.', env);
      return;
    }
    await sendChatAction(chatId, env, 'upload_photo');
    await replyWithImage(chatId, prompt, IMAGE_MODEL_FAST, env);
    return;
  }

  if (text === '/imagehd' || text.startsWith('/imagehd ')) {
    const prompt = text.slice('/imagehd'.length).trim();
    if (!prompt) {
      await sendMessage(chatId, 'بعد از دستور /imagehd توضیح تصویر رو بنویس.\nمثال: /imagehd یک منظره کوهستانی در غروب\n(این مدل باکیفیت‌تر ولی کندتره)', env);
      return;
    }
    await sendChatAction(chatId, env, 'upload_photo');
    await replyWithImage(chatId, prompt, IMAGE_MODEL_HQ, env);
    return;
  }

  if (!text) {
    await sendMessage(chatId, 'فعلاً فقط پیام متنی پشتیبانی میشه.', env);
    return;
  }

  await sendChatAction(chatId, env);
  await replyWithAI(chatId, text, env);
}

async function handleCallback(cb, env) {
  const chatId = cb.message.chat.id;
  const data = cb.data || '';

  if (data.startsWith('model:')) {
    const modelId = data.split(':')[1];
    const modelDef = MODELS.find((m) => m.id === modelId);
    if (!modelDef) return;

    await env.KV.put(`model:${chatId}`, modelId);
    await answerCallback(cb.id, env, `مدل ${modelDef.name} انتخاب شد`);
    await sendMessage(chatId, `✅ مدل فعال: ${modelDef.name}\nحالا سوالت رو بپرس.`, env);
  }
}

// ------------------------------------------------------------
// فراخوانی Workers AI و مدیریت تاریخچه مکالمه
// ------------------------------------------------------------
async function replyWithAI(chatId, text, env) {
  const modelId = (await env.KV.get(`model:${chatId}`)) || DEFAULT_MODEL_ID;
  const modelDef = MODELS.find((m) => m.id === modelId) || MODELS.find((m) => m.id === DEFAULT_MODEL_ID);

  const history = await getHistory(chatId, env);
  history.push({ role: 'user', content: text });

  try {
    const result = await env.AI.run(modelDef.model, {
      messages: [
        { role: 'system', content: 'You are a helpful, concise assistant. Reply in the same language the user writes in.' },
        ...history,
      ],
      max_tokens: 1536,
    });

    const reply = extractText(result);

    if (!reply) {
      console.error('Empty/unrecognized AI response shape:', JSON.stringify(result).slice(0, 500));
      await sendMessage(chatId, `⚠️ مدل ${modelDef.name} پاسخ قابل‌فهمی برنگردوند. با /model یه مدل دیگه رو امتحان کن.`, env);
      return;
    }

    history.push({ role: 'assistant', content: reply });
    await saveHistory(chatId, history, env);
    await sendMessage(chatId, `${modelDef.name}\n\n${reply}`, env);
  } catch (err) {
    console.error('AI run error:', err && err.message ? err.message : String(err));
    await sendMessage(chatId, '⚠️ خطا در دریافت پاسخ از مدل. چند لحظه دیگه دوباره امتحان کن یا با /model مدل رو عوض کن.', env);
  }
}

// استخراج متن پاسخ از سه فرمت متفاوتی که Workers AI ممکنه برگردونه:
//  ۱) فرمت کلاسیک chat-completion:            { response: "متن پاسخ" }
//  ۲) فرمت OpenAI Chat Completions (GPT-OSS، GLM، DeepSeek):
//        { choices: [ { message: { content: "متن پاسخ", reasoning_content: "زنجیره فکر" } } ] }
//  ۳) فرمت Responses API:                     { output: [ { type: "message", content: [ { type: "output_text", text: "..." } ] }, ... ] }
function extractText(result) {
  if (!result) return null;

  if (typeof result.response === 'string' && result.response.trim()) {
    return stripThinking(result.response);
  }

  if (Array.isArray(result.choices) && result.choices.length) {
    const msg = result.choices[0].message;
    if (msg && typeof msg.content === 'string' && msg.content.trim()) {
      return stripThinking(msg.content);
    }
  }

  if (Array.isArray(result.output)) {
    for (const item of result.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        const part = item.content.find(
          (c) => c.type === 'output_text' || c.type === 'text'
        );
        if (part && part.text) return stripThinking(part.text);
      }
    }
  }

  if (typeof result.result === 'string' && result.result.trim()) {
    return stripThinking(result.result);
  }

  return null;
}

// مدل‌های استدلالی (مثل DeepSeek R1) گاهی زنجیره فکر خودشون رو
// داخل تگ <think>...</think> برمی‌گردونن؛ اینو قبل از ارسال به کاربر حذف می‌کنیم.
function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

async function getHistory(chatId, env) {
  const raw = await env.KV.get(`history:${chatId}`);
  return raw ? JSON.parse(raw) : [];
}

async function saveHistory(chatId, history, env) {
  const trimmed = history.slice(-MAX_HISTORY);
  await env.KV.put(`history:${chatId}`, JSON.stringify(trimmed), {
    expirationTtl: HISTORY_TTL,
  });
}

// ------------------------------------------------------------
// توابع کمکی برای صحبت با API بله
// ------------------------------------------------------------
async function sendMessage(chatId, text, env) {
  await fetch(`${baleApi(env.BALE_BOT_TOKEN)}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function sendChatAction(chatId, env, action = 'typing') {
  await fetch(`${baleApi(env.BALE_BOT_TOKEN)}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action }),
  });
}

async function sendPhoto(chatId, imageBytes, caption, env) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption.slice(0, 1000));
  form.append('photo', new Blob([imageBytes], { type: 'image/jpeg' }), 'image.jpg');

  await fetch(`${baleApi(env.BALE_BOT_TOKEN)}/sendPhoto`, {
    method: 'POST',
    body: form,
  });
}

async function replyWithImage(chatId, prompt, model, env) {
  try {
    const result = await env.AI.run(model, {
      prompt,
      seed: Math.floor(Math.random() * 1000000),
    });

    let bytes = null;

    // فرمت Flux: { image: "base64رشته" }
    if (result && typeof result.image === 'string') {
      const binary = atob(result.image);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    }
    // فرمت مدل‌های Stable Diffusion: بایت خام تصویر (Response/ReadableStream)
    else if (result) {
      const buf = await new Response(result).arrayBuffer();
      if (buf && buf.byteLength) bytes = new Uint8Array(buf);
    }

    if (!bytes || !bytes.length) {
      await sendMessage(chatId, '⚠️ ساخت تصویر جواب قابل‌فهمی برنگردوند.', env);
      return;
    }

    await sendPhoto(chatId, bytes, prompt, env);
  } catch (err) {
    console.error('Image gen error:', err && err.message ? err.message : String(err));
    await sendMessage(chatId, '⚠️ خطا در ساخت تصویر. دوباره امتحان کن (یا مدل دیگه‌ای رو امتحان کن).', env);
  }
}

async function answerCallback(callbackId, env, text) {
  await fetch(`${baleApi(env.BALE_BOT_TOKEN)}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text }),
  });
}

async function sendModelPicker(chatId, env) {
  const keyboard = {
    inline_keyboard: MODELS.map((m) => [{ text: m.name, callback_data: `model:${m.id}` }]),
  };
  await fetch(`${baleApi(env.BALE_BOT_TOKEN)}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: 'یکی از مدل‌ها رو انتخاب کن:',
      reply_markup: keyboard,
    }),
  });
}
