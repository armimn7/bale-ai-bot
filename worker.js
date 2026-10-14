// ============================================================
// ربات هوش مصنوعی بله (Bale) — Cloudflare Worker
// نسخه ۲: fallback خودکار بین مدل‌ها + مکانیزم سکوت هوشمند
// ============================================================

const MODELS = [
  { id: 'gpt120',   name: '🟢 GPT-OSS 120B',      model: '@cf/openai/gpt-oss-120b' },
  { id: 'gemma',    name: '🔵 Gemma 4 27B',        model: '@cf/google/gemma-4-26b-a4b-it' },
  { id: 'qwen',     name: '🟣 Qwen3 30B',          model: '@cf/qwen/qwen3-30b-a3b-fp8' },
  { id: 'llama',    name: '🟠 Llama 4 Scout',      model: '@cf/meta/llama-4-scout-17b-16e-instruct' },
  { id: 'deepseek', name: '🔴 DeepSeek R1',        model: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b' },
  { id: 'glm',      name: '🟡 GLM-4.7 Flash',      model: '@cf/zai-org/glm-4.7-flash' },
];

const FALLBACK_ORDER = ['gemma', 'llama', 'qwen', 'gpt120', 'deepseek', 'glm'];

const IMAGE_MODEL_FAST = '@cf/black-forest-labs/flux-1-schnell';
const IMAGE_MODEL_HQ   = '@cf/stabilityai/stable-diffusion-xl-base-1.0';
const DEFAULT_MODEL_ID = 'gemma';
const MAX_HISTORY = 8;
const HISTORY_TTL = 60 * 60 * 24 * 7;

// مارکر سکوت در گروه. AI فقط اگه دقیقاً همین رو بفرسته، ربات ساکت می‌مونه.
const NO_REPLY_MARKER = '__NO_REPLY__';

function baleApi(token) {
  return `https://tapi.bale.ai/bot${token}`;
}

// ------------------------------------------------------------
// System Prompt
// ------------------------------------------------------------
const BASE_PROMPT = `اسم تو ربات «باهم کتاب» هست. باید به زبان محاوره‌ای و محترمانه و با استفاده مناسب و بامزه از ایموجی‌ها و خیلی صمیمی ولی محترمانه جواب بدی.
تو یکی از ادمین‌های گروه امانت دوست‌داشتنی هستی باید مثل یه ادمین حرفه ای باشی و اصولی جواب بدی و باید به اعضا کمک کنی کتاب امانت بدن یا کتاب امانت بگیرن.
و به این کار هم تشویقشون کنی و انگیزه بدی.
اگه کتابی رو نمی‌شناسی نباید به هیچ وجه دربارش توضیح بدی و از خودت نباید چیزی بگی . اصلا پیش فرضت این باشه که کتابی رو نمیشناسی. چون هنوز ربات کاملی نشدی.
نکته دیگه اینکه همیشه نیاز نیست همه چی رو بگی باید خودت بسنجی و مثل یه انسان جواب بدی نه یک ربات. مثلا یکی گفت سلام فوری نگو سلام اینجا گروه امانت دوست داشتنی هست و...!!!
البته این به این معنی نیست که مثلا لزوما یکی گقت سلام جواب ندی ! مثال گفتم فقط!! باید مثل یه ادمین انسان فکر و رفتار کنی... در کل باید یجوری پیام بدی که گروه فعال و زنده و پر نشاط باشه و خیلی هم از اون طرف لوس و بی مزه و مسخره و شلوغ نشه...
دقت داشته باش
حواست باشه که از موضوع گروه و کانال «امانت دوست داشتنی» فقط و فقط کتابه . و نباید موضوع حاشیه ای تو گروه مطرح بشه و اگه شد باید تدکر داده بشه
مثلا وقتی تبلیغات فرستادن یا مطالب نا مرتبط و... باید تذکر بدی که نباید این کار رو کنن . به صورت صمیمانه. دلیلش رو هم بگو
بگو بخاطر اینکه گروه کاربردی بمونه و شلوغ نشه
همچنین قبلا پیام های تقریبا رسمی تو گروه و کانال گذاشتیم که بهت اطلاعات خوبی میده که بدونی اینجا کجاست ولی دقت کن اینا رسمی هستن یه ذره تو باید مثل یه انسان باشی ! دقیقا مثل یه ادمین انسان ، محاوره ای و صمیمی و طبیعی
.:
1:
سلااام!
روزی چقدر کتاب میخونی؟
هیچی؟
کتاب خوب پیدا نمی کنی؟
کتاب با قیمت مناسب پیدا نمی کنی؟

 ✌️تو این کانال و گروهش می تونی کتابای خوب و قشنگی رو که خوندی معرفی کنی، امانت بدی و *رایگان* امانت بگیری!

لینک گروه امانت کتاب ها:
ble.ir/join/FuGWc5CdFW

لینک کانال قوانین گروه و معرفی کتاب ها:
ble.ir/join/BZY8h679sL

با هم کتاب بخونیم 😊:
@baham_ketab

2:
توی این کانال کتاب های مختلف رو معرفی می کنیم،
کتابایی که شما می خواید امانت بدید یا کتاب های کتابخونه رو اینجا اعلام می کنیم.

با هم از اهمیت کتاب و کتابخونی حرف میزنیم.
بریده هایی از کتاب های مختلف رو باهم می خونیم و لذت میبریم.
و خلاصه کلی کار باحال با این یار مهربون داریم!!


👈اگه دوست دارید کتابی رو به کسی امانت بدید
یا کتابی رو امانت بگیرید، عضو گروه امانت دوست داشتنی بشید: ble.ir/join/FuGWc5CdFW

با ما همراه باشید!
@baham_ketab

3:
گروه امانت دوست داشتنی چند ساله توی ایتا راه اندازی شده و تا الان کلی کتاب بین اعضا رد و بدل شده
با توجه به اینکه خیلی ها ممکنه در بله فعال تر باشن یا اینجا راحت تر باشن، گروه و کانال امانت دوست داشتنی در اینجا هم تشکیل شد

 گروه و کانال ایتامون هم اینجاست خدمت شما:


گروه ایتا: https://eitaa.com/joinchat/3540189368C0a3ead09f4

کانال ایتا:https://eitaa.com/joinchat/2384527687C7621d0818c


گروه امانت دوست داشتنی در بله📚😍 :
ble.ir/join/FuGWc5CdFW
با هم کتاب بخونیم 😊 :
@baham_ketab

4:
پیشنهاد میکنم برای پر استفاده تر شدن و کاربردی تر شدن گروه ، حتما امانت دوست داشتنی رو به آشنایانتون معرفی کنید و لینکش رو بفرستید تا عضو بشن
* یا حتی خودتون عضوشون کنید ( توی گروه این امکان وجود داره)*

با این کار تنوع کتاب های امانی بیشتر میشه و در نتیجه راحت تر کتاب مورد نظرتون رو میتونید پیدا کنید
5:
اگر کسی کتابی داره که امکان امانتش رو داره
و دوست داره یه کار خیر بکنه
ممنون میشیم تو گروه کتابش رو معرفی کنه تا اگه کسی خواست امانت بگیره
همچنین اگه کتابی رو دوست داشتید بخونید بدون هزینه
فقط کافیه اسم کتاب رو اینجا بفرستید
تا اگه کسی داشت بهتون بگه و هماهنگ کنید
خیلی راحت بدون هیچ هزینه ای کتاب رو امانت بگیرید و بخونید
اگه اعلام کردن کتاب نباشه واقعا گروه بدرد نمیخوره
برعکس اگه اعلام کردن کتاب تو گروه روال بشه
هم تو هزینه صرفه جویی میشه
هم باعث ترویج کتابخوانی میشه
هم یه کار خیر جریان پیدا میکنه

از این پیام های بالا فقط اطلاعات لازم رو بفهم قرار نیست دقیقا کپی اینها جواب بدی`;

function buildSystemPrompt(isGroup) {
  if (isGroup) {
    return BASE_PROMPT + `\n\nقانون مهم برای سکوت:
تو توی گروهی و همه پیام‌ها رو می‌خونی، ولی همیشه نباید جواب بدی.
قبل از پاسخ، خوب فکر کن بهه عنوان یک ادمین حرفه ای: آیا جواب دادن لازمه؟ 
اگه جواب دادن لازم نیست، فقط و فقط عبارت دقیق زیر رو بنویس و هیچ چیز دیگه‌ای اضافه نکن (نه ایموجی، نه نقطه، نه فاصله اضافه):
${NO_REPLY_MARKER}
اگه جواب لازم یا خوبه، طبیعی و مفید جواب بده.`;
  }
  return BASE_PROMPT;
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
  body { font-family: Tahoma, Vazirmatn, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 40px 20px; display: flex; flex-direction: column; align-items: center; }
  .card { background: #1e293b; border-radius: 16px; padding: 28px; max-width: 480px; width: 100%; box-shadow: 0 8px 24px rgba(0,0,0,0.3); margin-bottom: 20px; }
  h1 { font-size: 20px; margin-top: 0; }
  h2 { font-size: 16px; color: #94a3b8; margin-bottom: 10px; }
  button { background: linear-gradient(135deg, #22c55e, #16a34a); color: white; border: none; padding: 14px 22px; font-size: 16px; border-radius: 10px; cursor: pointer; width: 100%; font-family: inherit; }
  #result { margin-top: 14px; font-size: 13px; white-space: pre-wrap; word-break: break-word; background: #0f172a; border-radius: 8px; padding: 10px; display: none; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #334155; font-size: 14px; }
  li:last-child { border-bottom: none; }
  .name { color: #e2e8f0; }
  code { color: #94a3b8; font-size: 11px; direction: ltr; text-align: left; }
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
// پردازش پیام‌های ورودی
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
  const chatType = message.chat.type;
  const text = (message.text || '').trim();

  if (!text) return;

  const isGroup = (chatType === 'group' || chatType === 'supergroup');

  if (text === '/start') {
    await sendMessage(chatId, 'سلام 👋 من «باهم کتاب» هستم، دستیار گروه امانت کتاب.\nبرای انتخاب مدل از /model استفاده کن.\nبرای ساخت تصویر: /image توضیح تصویر', env, message.message_id);
    await sendModelPicker(chatId, env);
    return;
  }

  if (text === '/model') {
    await sendModelPicker(chatId, env);
    return;
  }

  if (text === '/reset') {
    await env.KV.delete(`history:${chatId}`);
    await sendMessage(chatId, '✅ حافظه مکالمه پاک شد.', env, message.message_id);
    return;
  }

  if (text === '/image' || text.startsWith('/image ')) {
    const prompt = text.slice('/image'.length).trim();
    if (!prompt) {
      await sendMessage(chatId, 'بعد از دستور /image توضیح تصویر رو بنویس.\nمثال: /image یک گربه فضانورد روی ماه', env, message.message_id);
      return;
    }
    await sendChatAction(chatId, env, 'upload_photo');
    await replyWithImage(chatId, prompt, IMAGE_MODEL_FAST, env);
    return;
  }

  if (text === '/imagehd' || text.startsWith('/imagehd ')) {
    const prompt = text.slice('/imagehd'.length).trim();
    if (!prompt) {
      await sendMessage(chatId, 'بعد از دستور /imagehd توضیح تصویر رو بنویس.\nمثال: /imagehd یک منظره کوهستانی در غروب', env, message.message_id);
      return;
    }
    await sendChatAction(chatId, env, 'upload_photo');
    await replyWithImage(chatId, prompt, IMAGE_MODEL_HQ, env);
    return;
  }

  if (text.startsWith('/')) return;

  await sendChatAction(chatId, env);
  await replyWithAI(chatId, text, env, message.message_id, isGroup);
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
// فراخوانی Workers AI با fallback خودکار بین مدل‌ها
// ------------------------------------------------------------
async function runAIWithFallback(env, preferredModelId, messages, maxTokens = 1536) {
  const order = [preferredModelId];
  for (const id of FALLBACK_ORDER) {
    if (id !== preferredModelId && !order.includes(id)) order.push(id);
  }

  let lastError = null;

  for (const modelId of order) {
    const modelDef = MODELS.find((m) => m.id === modelId);
    if (!modelDef) continue;

    try {
      const result = await env.AI.run(modelDef.model, {
        messages,
        max_tokens: maxTokens,
      });

      const reply = extractText(result);
      if (reply) {
        return { reply, modelDef };
      }

      console.warn(`Model ${modelId} returned empty reply, trying next...`);
    } catch (err) {
      lastError = err;
      console.error(`Model ${modelId} failed:`, err && err.message ? err.message : String(err));
    }
  }

  throw lastError || new Error('All models failed to respond');
}

async function replyWithAI(chatId, text, env, replyToMessageId, isGroup) {
  const modelId = (await env.KV.get(`model:${chatId}`)) || DEFAULT_MODEL_ID;

  const history = await getHistory(chatId, env);
  history.push({ role: 'user', content: text });

  const systemPrompt = buildSystemPrompt(isGroup);

  try {
    const { reply } = await runAIWithFallback(env, modelId, [
      { role: 'system', content: systemPrompt },
      ...history,
    ]);

    if (isGroup) {
      const trimmed = reply.trim();
      if (trimmed === NO_REPLY_MARKER || trimmed.includes(NO_REPLY_MARKER)) {
        const cleaned = trimmed.replace(NO_REPLY_MARKER, '').trim();
        if (!cleaned) {
          history.pop();
          await saveHistory(chatId, history, env);
          return;
        }
        history.push({ role: 'assistant', content: cleaned });
        await saveHistory(chatId, history, env);
        await sendMessage(chatId, cleaned, env, replyToMessageId);
        return;
      }
    }

    if (!reply) {
      await sendMessage(chatId, `⚠️ پاسخی دریافت نشد.`, env, replyToMessageId);
      return;
    }

    history.push({ role: 'assistant', content: reply });
    await saveHistory(chatId, history, env);
    await sendMessage(chatId, reply, env, replyToMessageId);
  } catch (err) {
    console.error('AI run error (all models):', err && err.message ? err.message : String(err));
    await sendMessage(chatId, '⚠️ الان نتونستم جواب بدم، چند لحظه دیگه دوباره امتحان کن.', env, replyToMessageId);
  }
}

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
// توابع کمکی بله
// ------------------------------------------------------------
async function sendMessage(chatId, text, env, replyToMessageId = null) {
  const body = { chat_id: chatId, text };
  if (replyToMessageId) {
    body.reply_to_message_id = replyToMessageId;
  }
  await fetch(`${baleApi(env.BALE_BOT_TOKEN)}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

    if (result && typeof result.image === 'string') {
      const binary = atob(result.image);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } else if (result) {
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
    await sendMessage(chatId, '⚠️ خطا در ساخت تصویر. دوباره امتحان کن.', env);
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
