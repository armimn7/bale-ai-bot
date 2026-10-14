// ============================================================
// ربات هوش مصنوعی بله (Bale) — Cloudflare Worker
// نسخه ۱۴: صف کانتکست + پرامپت مخصوص /reply
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

const MAX_HISTORY = 20;
const HISTORY_TTL = 60 * 60 * 24 * 7;
const MSG_TTL = 60 * 60 * 24 * 7;
const CTX_QUEUE_TTL = 60 * 60;

const NO_REPLY_MARKER = '__NO_REPLY__';
const DELETE_MARKER   = '__DELETE__';

function baleApi(token) {
  return `https://tapi.bale.ai/bot${token}`;
}

async function checkIsAdmin(chatId, userId, env) {
  if (!chatId || !userId) return false;
  try {
    const res = await fetch(`${baleApi(env.BALE_BOT_TOKEN)}/getChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, user_id: userId }),
    });
    const data = await res.json();
    if (!data.ok) return false;
    const status = data.result && data.result.status;
    return status === 'administrator' || status === 'creator';
  } catch (err) {
    console.error('checkIsAdmin error:', err && err.message ? err.message : String(err));
    return false;
  }
}

function gregorianToJalali(gy, gm, gd) {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = (gy <= 1600) ? 0 : 979;
  gy -= (gy <= 1600) ? 621 : 1600;
  const gy2 = (gm > 2) ? (gy + 1) : gy;
  let days = (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) - 80 + gd + g_d_m[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
  return { jy, jm, jd };
}

function getIranTimestamp(unixSeconds) {
  if (!unixSeconds) return '';
  const iranMs = unixSeconds * 1000 + (3 * 60 + 30) * 60 * 1000;
  const d = new Date(iranMs);
  const gy = d.getUTCFullYear();
  const gm = d.getUTCMonth() + 1;
  const gd = d.getUTCDate();
  const { jy, jm, jd } = gregorianToJalali(gy, gm, gd);
  const h = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const weekdays = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
  const weekday = weekdays[d.getUTCDay()];
  return `${weekday} ${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')} ساعت ${h}:${min}`;
}

// ============================================================
// پرامپت اصلی گروه (دقیقاً همون قوانین خودت)
// ============================================================
const BASE_PROMPT = `اسم تو ربات «باهم کتاب» هست. تو عضو تیم امانت دوست داشتنی هستی و یکی از مدیریت کننده های خوب گروه امانت دوست داشتنی.باید به زبان محاوره‌ای و محترمانه و با استفاده مناسب و بامزه از ایموجی‌ها و خیلی صمیمی ولی محترمانه جواب بدی 
از افعال جمع هم تا جای امکان استفاده کن که احترام حفظ بشه ولی صمیمی و دوست داشتنی باش.
از خطاب هایی مثل علی عزیز یا زهرا جان و... پرهیز کن تا جای ممکن که یه وقت برای کسی سوء تفاهم پیش نیاد. ولی صمیمی باش
ضمن اینکه اصلا خیلی از اوقات بعضی کاربر ها اسمشون اصلا مشخص نمیکنه چیه حتی جنسیتشون رو هم مشخص نمیکنه
تو یکی از ادمین‌های گروه امانت دوست‌داشتنی هستی باید مثل یه ادمین حرفه ای باشی و اصولی جواب بدی و باید به اعضا کمک کنی کتاب امانت بدن یا کتاب امانت بگیرن.
و به این کار هم تشویقشون کنی و انگیزه بدی.
اگه کتابی رو نمی‌شناسی نباید به هیچ وجه دربارش توضیح بدی و از خودت نباید چیزی بگی . اصلا پیش فرضت این باشه که کتابی رو نمیشناسی. چون هنوز ربات کاملی نشدی.
نکته دیگه اینکه همیشه نیاز نیست همه چی رو بگی باید خودت بسنجی و مثل یه انسان جواب بدی نه یک ربات. مثلا یکی گفت سلام فوری نگو سلام اینجا گروه امانت دوست داشتنی هست و...!!!
البته این به این معنی نیست که مثلا لزوما یکی گقت سلام جواب ندی ! مثال گفتم فقط!! باید مثل یه ادمین انسان فکر و رفتار کنی... در کل باید یجوری پیام بدی که گروه فعال و زنده و پر نشاط باشه و خیلی هم از اون طرف لوس و بی مزه و مسخره و شلوغ نشه...
دقت داشته باش
حواست باشه که از موضوع گروه و کانال «امانت دوست داشتنی» فقط و فقط کتابه . و نباید موضوع حاشیه ای تو گروه مطرح بشه و اگه شد باید تدکر داده بشه
مثلا وقتی تبلیغات فرستادن یا مطالب نا مرتبط و... باید تذکر بدی که نباید این کار رو کنن . به صورت صمیمانه. دلیلش رو هم بگو
.
بگو بخاطر اینکه گروه کاربردی بمونه و شلوغ نشه
همچنین یه سری چیزا رو باید بدونی اینکه مثلا اعضا کتاب رو تو شخصی (پیوی) با هم هماهنگ میکنن خودشون معمولا که چجوری از هم بگیرن
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


از این پیام های بالا فقط اطلاعات لازم رو بفهم قرار نیست دقیقا کپی اینها جواب بدی
مثلا تو به عنوان یک ادمین گروه نباید بیخودی هی لینک گروه و کانال رو بفرستی. فقط وقتی که نیاز شد باید بفرستی . باید سیاست داشته باشی
هر پیامی باید علت داشت باشه و درست و به موقع فرستاده شده باشه

قوانین مهم رفتار طبیعی (خیلی مهم):
1)وقتی چیزی رو نمیدونی نگو. تو فقط ادمین گروه هستی و کارت مدیریت گروه و تشویق و راهنمایی عمومی اعضا در امانت دادن یا گرفتن کتاب هست. 
به سوالات دیگه اصلا نباید جواب بدی 
۲) از قالب‌های تکراری پرهیز کن. مثلا هر بار نگو «X عزیز» یا «بقیه اعضای عزیز» یا «ایشالا». اینا کلیشه هستن و بار دوم به بعد مسخره می‌شن.
۳) جواب کوتاه و مستقیم. اگه با یک جمله می‌شه جواب داد، همون یک جمله کافیه. پاراگراف طولانی ننویس.
۴) اسم فرستنده‌ها توی متن پیام‌ها با فرمت «اسم: متن» مشخصه. حواست باشه کی داره حرف می‌زنه و با کی طرفه.
۵) نقش افراد رو تشخیص بده:
   - «صاحب کتاب»: کسی که می‌گه «من دارم» یا «کتابم رو امانت می‌دم».
   - «متقاضی»: کسی که کتابی رو می‌خواد یا می‌پرسه «چطوری امانت بگیرم».
۶) وقتی یکی می‌گه «دارم» و یکی می‌پرسه «چطوری ازت امانت بگیرم» → اینا رو مستقیم به هم وصل کن. مثلا بنویس: «[اسم صاحب کتاب] جان، [اسم متقاضی] می‌خواد این کتاب رو ازتون بگیره. با هم هماهنگ کنید.» یا حتی شماره/راه ارتباطی رو اگه داری بگو.
۷) همیشه فقط یه توضیح کلی و آموزشی نده وقتی می‌تونی مستقیم به موقعیت جواب بدی. مثلا اگه کسی می‌پرسه «چطوری امانت بگیرم ازت؟» نگو «کافیه اسم کتاب رو بنویسید...». باید بگی «با [اسم صاحب کتاب] هماهنگ کنید» فقط وقتی نیاز به راهنمایی عمومی هست عمومی راهنمایی کن بادی بتونی اینا رو تمییز بدی..
۸) مثل یه آدم واقعی که توی گروه چت می‌کنه تایپ کن. آدم واقعی توی هر پیام درس نمی‌ده، گاهی فقط یه جمله کوتاه می‌گه، گاهی سوال می‌پرسه، گاهی تشویق می‌کنه.
۹) توی تاریخچه پیام‌ها، هر پیام کاربر با پیشوندی مثل «[پنجشنبه ۱۴۰۳/۰۷/۲۴ ساعت ۱۴:۳۰]» شروع می‌شه که تاریخ و ساعت ارسال اونه. این پیشوندها فقط برای اطلاعات تو هستن تا بدونی الان چه موقع از روز و چه روزیه (صبح، شب، تعطیلات و...). 
⚠️ تو توی پاسخ‌هات هرگز نباید این پیشوند تاریخ/ساعت یا اسم خودت («باهم کتاب:») رو بنویسی. فقط و فقط متن خالص جواب رو بنویس.`;

// ============================================================
// پرامپت مخصوص /reply — فقط قوانین ادمین برای جواب هدفمند
// (این قوانین هم مستقیماً از حرف‌های خودت گرفته شده)
// ============================================================
const REPLY_SYSTEM_PROMPT = `تو «باهم کتاب» هستی، یکی از ادمین‌های گروه «امانت دوست داشتنی».

⚠️ قوانین مطلق (اینها رو تحت هیچ شرایطی نقض نکن):

۱) همیشه از افعال جمع استفاده کن: «بگیرید»، «بدید»، «بفرمایید»، «ممنونم»، «بتونید»، نه «بگیر»، «بده»،  «بتونی».

۲) هرگز اسم طرف رو صدا نزن. نه «محمود جان»، نه «محمود عزیز»، نه هیچ اسم دیگه‌ای. خطاب مستقیم با اسم ممنوعه.

۳) اغراق نکن. از «وای عالیه!»، «فوق‌العاده!»، «بی‌نظیرید!»، «چه عالی!» و کلیشه‌ها پرهیز کن. تشکر ساده و صمیمی کافیه.

۴) جواب کوتاه: ۱ تا ۳ خط، نه بیشتر. زیاده‌گویی نکن.

۵) ایموجی کم و به‌جا (حداکثر ۱ تا ۲ عدد در کل پیام).

۶) دقیقاً به پیام بخش «[پیام هدف]» جواب بده — نه به پیام‌های کانتکست، نه به چیز دیگه‌ای.

۷) اگه «[دستور ادمین]» داده شده، اون رو دقیقاً و بدون کم و کاست اجرا کن. دستور ادمین بالاتر از هر چیز دیگه‌ایه.

۸) لحن: صمیمی، محترمانه، محاوره‌ای، تشویق‌کننده به کتاب و امانت، بدون لوس‌بازی و بدون کلیشه.

حالا پیام و دستور رو بخون و فقط متن خالص جواب رو بنویس (بدون مقدمه، بدون توضیح اضافه، بدون تکرار اسم ادمین).`;

function buildSystemPrompt(isGroup) {
  if (isGroup) {
    return BASE_PROMPT + `\n\n⚠️ قانون مهم درباره کدام پیام را باید پاسخ دهی:
تو تاریخچه پیام‌های قبلی گروه رو داری (با اسم فرستنده و تاریخ و ساعت). این پیام‌ها فقط برای درک موقعیت هستن.
فقط و فقط به «آخرین پیام» توی تاریخچه جواب بده. به پیام‌های قبلی به هیچ‌وجه جواب نده، حتی اگه سوال بی‌جواب داشته باشن.
پیام‌های قبلی فقط برای اینن که بدونی:
- الان توی گروه چه خبره؟
- کی با کیه؟
- اگه یکی داره به پیام قبلی یه نفر دیگه واکنش نشون می‌ده، بفهمی چی بوده.
پس هنگام نوشتن جواب، فقط پیام آخر رو در نظر بگیر و به بقیه کاری نداشته باش.

قانون مهم برای سکوت و حذف:
تو توی گروهی و همه پیام‌ها رو می‌خونی (با اسم فرستنده). ولی همیشه نباید جواب بدی.
قبل از پاسخ، خوب فکر کن به عنوان یک ادمین حرفه‌ای. لزومی نداره به هر پیامی جواب بدی. باید سیاست داشته باشی که ما رو به هدف اصلی 
یعنی فعال شدن گروه ببره نه چیز دیگه ای  و زیاده روی هم به این هدف لطمه میزنه:
جدای این باز هم نباید به هر سوالی جواب بدی . تو فقط ادمین مدیریت گروه هستی و وظیفت فعال و با نشاط نکه داشتن گروه هست و تشویق اعضا به امانت دادن یا گرفتن کتاب


۱) اگه پیام تبلیغاتی، نامرتبط با کتاب، یا حاشیه‌ست:
دقیقاً با این عبارت شروع کن: ${DELETE_MARKER}
و در ادامه (خط بعد یا همون خط) تذکرت رو بنویس.
مثال:
${DELETE_MARKER}
دوست عزیز، اینجا گروه کتابه و پست تبلیغاتی می‌تونه گروه رو شلوغ کنه. لطفاً پاکش کنیم که کاربردیمون حفظ بشه 🙏

نکته: این پیام از طرف کاربر خودکار حذف می‌شه و تذکر تو می‌مونه.
دقت کن اشتباه نکنی مثلا قرآن و آیه هاش و... هم جزو کتاب ها محسوب میشه و اگه کسی مطلبی در این باره نوشت ایرادی نداره. 
۲) اگه جواب دادن لازم نیست:
فقط و فقط عبارت دقیق زیر رو بنویس و هیچ چیز دیگه‌ای اضافه نکن (نه ایموجی، نه نقطه، نه فاصله اضافه):
${NO_REPLY_MARKER}

۳) در غیر این صورت:
طبیعی و مفید جواب بده.`;
  }
  return BASE_PROMPT;
}

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

async function handleUpdate(update, env) {
  if (update.callback_query) {
    return handleCallback(update.callback_query, env);
  }
  if (update.message) {
    return handleMessage(update.message, env);
  }
}

function getSenderName(message) {
  const from = message.from || {};
  const first = from.first_name || '';
  const last = from.last_name || '';
  const full = (first + ' ' + last).trim();
  if (full) return full;
  if (from.username) return from.username;
  return 'کاربر';
}

async function pushContextQueue(chatId, msgData, env) {
  try {
    const key = `ctxqueue:${chatId}`;
    const raw = await env.KV.get(key);
    const queue = raw ? JSON.parse(raw) : [];
    if (!queue.find((q) => q.messageId === msgData.messageId)) {
      queue.push(msgData);
    }
    const trimmed = queue.slice(-10);
    await env.KV.put(key, JSON.stringify(trimmed), { expirationTtl: CTX_QUEUE_TTL });
    return trimmed.length;
  } catch (err) {
    console.error('pushContextQueue error:', err);
    return 0;
  }
}

async function getAndClearContextQueue(chatId, env) {
  try {
    const key = `ctxqueue:${chatId}`;
    const raw = await env.KV.get(key);
    if (!raw) return [];
    const queue = JSON.parse(raw);
    await env.KV.delete(key);
    return queue;
  } catch (err) {
    return [];
  }
}

async function handleMessage(message, env) {
  const chatId = message.chat.id;
  const chatType = message.chat.type;
  const text = (message.text || '').trim();
  const senderName = getSenderName(message);
  const senderId = message.from && message.from.id;

  if (!text) return;

  const isGroup = (chatType === 'group' || chatType === 'supergroup');
  const messageDate = message.date || Math.floor(Date.now() / 1000);

  if (isGroup && message.reply_to_message) {
    const rtm = message.reply_to_message;
    const rtmText = (rtm.text || rtm.caption || '').trim();
    if (rtmText) {
      await storeMessage(chatId, rtm.message_id, getSenderName(rtm), rtmText, rtm.date || Math.floor(Date.now() / 1000), env);
    }
  }

  if (text === '/myid') {
    if (isGroup) {
      await deleteMessage(chatId, message.message_id, env);
      await sendMessage(senderId, `🆔 آیدی عددی شما: \`${senderId || 'نامشخص'}\`\nآیدی این گروه: \`${chatId}\``, env);
    } else {
      await sendMessage(chatId, `🆔 آیدی عددی شما: \`${senderId || 'نامشخص'}\`\nآیدی این چت: \`${chatId}\``, env, message.message_id);
    }
    return;
  }

  if (text === '/start' && !isGroup) {
    await sendMessage(chatId, 'سلام 👋 من «باهم کتاب» هستم، دستیار گروه امانت کتاب.\n\n📌 دستورات ادمین:\n\n🔹 /myid — آیدی عددی\n🔹 /infoid — توی گروه، با ریپلای روی هر پیام\n🔹 /reply <chat_id> <msg_id> [راهنما] — ریپلای هوشمند\n🔹 /edit <chat_id> <msg_id> <متن> — ویرایش پیام ربات\n🔹 /model — تغییر مدل AI\n🔹 /reset — تأیید\n🔹 /clear <chat_id> — پاک کردن حافظه گروه', env, message.message_id);
    return;
  }

  if (isGroup) {
    await storeMessage(chatId, message.message_id, senderName, text, messageDate, env);
  }

  if (text === '/infoid' && isGroup) {
    const target = message.reply_to_message;
    await deleteMessage(chatId, message.message_id, env);
    if (!target) return;

    const targetSender = getSenderName(target);
    const targetText = (target.text || target.caption || '').trim();
    const targetDate = target.date || Math.floor(Date.now() / 1000);

    if (targetText) {
      await storeMessage(chatId, target.message_id, targetSender, targetText, targetDate, env);
    }

    const queueLength = await pushContextQueue(chatId, {
      messageId: target.message_id,
      sender: targetSender,
      text: targetText,
      date: targetDate,
    }, env);

    const infoMsg = `📌 اطلاعات پیام:\n\n` +
      `chat_id: \`${chatId}\`\n` +
      `message_id: \`${target.message_id}\`\n` +
      `فرستنده: ${targetSender}\n` +
      `زمان: ${getIranTimestamp(targetDate)}\n` +
      `متن: ${targetText.slice(0, 200)}${targetText.length > 200 ? '...' : ''}\n\n` +
      `📚 الان ${queueLength} پیام توی صف کانتکست هست.\n\n` +
      `برای ریپلای توی چت خصوصی:\n\`/reply ${chatId} ${target.message_id} [راهنما]\`\n\n` +
      `برای ویرایش (اگه پیام رباته):\n\`/edit ${chatId} ${target.message_id} <متن جدید>\``;

    try {
      await sendMessage(senderId, infoMsg, env);
    } catch (err) {
      console.error('infoid PM error:', err);
    }
    return;
  }

  if (text === '/model' && isGroup) {
    const ok = await checkIsAdmin(chatId, senderId, env);
    await deleteMessage(chatId, message.message_id, env);
    if (!ok) return;
    await sendModelPicker(chatId, env);
    return;
  }

  if (text === '/reset' && isGroup) {
    const ok = await checkIsAdmin(chatId, senderId, env);
    await deleteMessage(chatId, message.message_id, env);
    if (!ok) return;
    await sendMessage(senderId, '✅ تنظیمات ربات به‌روزه.\n\n💡 حافظه پیام‌ها دست نخورده.\nبرای پاک کردن حافظه: `/clear ' + chatId + '`', env);
    return;
  }

  if (text === '/reset' && !isGroup) {
    await sendMessage(chatId, '✅ تنظیمات به‌روزه (حافظه دست نخورده).\n\n💡 برای پاک کردن حافظه گروه: `/clear <chat_id>`', env, message.message_id);
    return;
  }

  if (text === '/clear' && isGroup) {
    const ok = await checkIsAdmin(chatId, senderId, env);
    await deleteMessage(chatId, message.message_id, env);
    if (!ok) return;
    await env.KV.delete(`history:${chatId}`);
    await env.KV.delete(`ctxqueue:${chatId}`);
    await sendMessage(senderId, `✅ حافظه گروه \`${chatId}\` پاک شد.`, env);
    return;
  }

  if (text.startsWith('/clear ') && !isGroup) {
    const rest = text.replace(/^\/clear\s*/i, '').trim();
    const targetChatId = Number(rest);
    if (!targetChatId) {
      await sendMessage(chatId, '❌ آیدی نامعتبره.', env, message.message_id);
      return;
    }
    const ok = await checkIsAdmin(targetChatId, senderId, env);
    if (!ok) {
      await sendMessage(chatId, '⚠️ شما ادمین آن گروه نیستید.', env, message.message_id);
      return;
    }
    await env.KV.delete(`history:${targetChatId}`);
    await env.KV.delete(`ctxqueue:${targetChatId}`);
    await sendMessage(chatId, `✅ حافظه گروه \`${targetChatId}\` پاک شد.`, env, message.message_id);
    return;
  }

  if (text === '/edit' || text.startsWith('/edit ') || text.startsWith('/edit\n')) {
    if (!isGroup) {
      const rest = text.replace(/^\/edit\s*/i, '').trim();
      const parts = rest.split(/\s+/);
      if (parts.length < 3) {
        await sendMessage(chatId, 'فرمت: `/edit <chat_id> <message_id> <متن جدید>`', env, message.message_id);
        return;
      }
      const targetChatId = Number(parts[0]);
      const targetMessageId = Number(parts[1]);
      const newText = parts.slice(2).join(' ');

      const ok = await checkIsAdmin(targetChatId, senderId, env);
      if (!ok) {
        await sendMessage(chatId, '⚠️ شما ادمین آن گروه نیستید.', env, message.message_id);
        return;
      }

      await editMessageText(targetChatId, targetMessageId, newText, env);
      await sendMessage(chatId, `✅ پیام \`${targetMessageId}\` ویرایش شد.`, env, message.message_id);
      return;
    }

    const ok = await checkIsAdmin(chatId, senderId, env);
    await deleteMessage(chatId, message.message_id, env);
    if (!ok) return;

    const target = message.reply_to_message;
    if (!target) return;

    const isBotMessage = target.from && target.from.is_bot;
    if (!isBotMessage) return;

    const newText = text.replace(/^\/edit\s*/i, '').replace(/\r/g, '').trim();
    if (!newText) {
      await deleteMessage(chatId, target.message_id, env);
      return;
    }
    await editMessageText(chatId, target.message_id, newText, env);
    return;
  }

  if (text === '/reply' || text.startsWith('/reply ') || text.startsWith('/reply\n')) {
    if (!isGroup) {
      const rest = text.replace(/^\/reply\s*/i, '').trim();
      const parts = rest.split(/\s+/);
      if (parts.length < 2) {
        await sendMessage(chatId, 'فرمت: `/reply <chat_id> <message_id> [راهنما]`', env, message.message_id);
        return;
      }
      const targetChatId = Number(parts[0]);
      const targetMessageId = Number(parts[1]);
      const instruction = parts.slice(2).join(' ').trim();

      const ok = await checkIsAdmin(targetChatId, senderId, env);
      if (!ok) {
        await sendMessage(chatId, '⚠️ شما ادمین آن گروه نیستید.', env, message.message_id);
        return;
      }

      const target = await getStoredMessage(targetChatId, targetMessageId, env);
      if (!target) {
        await sendMessage(chatId, '⚠️ پیام پیدا نشد.\n\n💡 توی گروه روی همون پیام ریپلای بزن و /infoid بفرست تا ذخیره بشه.', env, message.message_id);
        return;
      }

      const contextQueue = await getAndClearContextQueue(targetChatId, env);

      await generateReplyToMessage(targetChatId, targetMessageId, target.sender, target.text, target.date, instruction, contextQueue, env);
      await sendMessage(chatId, `✅ جواب به پیام \`${targetMessageId}\` فرستاده شد.\n📚 از ${contextQueue.length} پیام کانتکست استفاده شد.`, env, message.message_id);
      return;
    }

    const ok = await checkIsAdmin(chatId, senderId, env);
    await deleteMessage(chatId, message.message_id, env);
    if (!ok) return;

    const originalMsg = message.reply_to_message;
    if (!originalMsg) return;

    const originalText = (originalMsg.text || originalMsg.caption || '').trim();
    if (!originalText) return;

    const originalSender = getSenderName(originalMsg);
    const originalId = originalMsg.message_id;
    const originalDate = originalMsg.date || Math.floor(Date.now() / 1000);
    const instruction = text.replace(/^\/reply\s*/i, '').replace(/\n/g, ' ').trim();

    const contextQueue = await getAndClearContextQueue(chatId, env);

    await generateReplyToMessage(chatId, originalId, originalSender, originalText, originalDate, instruction, contextQueue, env);
    return;
  }

  if (text === '/image' || text.startsWith('/image ')) {
    const prompt = text.slice('/image'.length).trim();
    if (isGroup) await deleteMessage(chatId, message.message_id, env);
    if (!prompt) {
      if (!isGroup) await sendMessage(chatId, 'بعد از /image توضیح تصویر رو بنویس.', env, message.message_id);
      return;
    }
    await sendChatAction(chatId, env, 'upload_photo');
    await replyWithImage(chatId, prompt, IMAGE_MODEL_FAST, env);
    return;
  }

  if (text === '/imagehd' || text.startsWith('/imagehd ')) {
    const prompt = text.slice('/imagehd'.length).trim();
    if (isGroup) await deleteMessage(chatId, message.message_id, env);
    if (!prompt) {
      if (!isGroup) await sendMessage(chatId, 'بعد از /imagehd توضیح تصویر رو بنویس.', env, message.message_id);
      return;
    }
    await sendChatAction(chatId, env, 'upload_photo');
    await replyWithImage(chatId, prompt, IMAGE_MODEL_HQ, env);
    return;
  }

  if (isGroup && text.startsWith('/')) {
    await deleteMessage(chatId, message.message_id, env);
    return;
  }
  if (!isGroup && text.startsWith('/')) return;

  await sendChatAction(chatId, env);
  await replyWithAI(chatId, text, env, message.message_id, isGroup, senderName, messageDate);
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
    await sendMessage(chatId, `✅ مدل فعال: ${modelDef.name}`, env);
  }
}

async function storeMessage(chatId, messageId, sender, text, date, env) {
  try {
    await env.KV.put(`msg:${chatId}:${messageId}`, JSON.stringify({
      chatId, messageId, sender, text, date,
    }), { expirationTtl: MSG_TTL });
  } catch (err) {
    console.error('storeMessage error:', err);
  }
}

async function getStoredMessage(chatId, messageId, env) {
  try {
    const raw = await env.KV.get(`msg:${chatId}:${messageId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

// ============================================================
// /reply — از REPLY_SYSTEM_PROMPT استفاده می‌کنه (نه BASE_PROMPT)
// ============================================================
async function generateReplyToMessage(chatId, originalId, originalSender, originalText, originalDate, instruction, contextQueue, env) {
  const modelId = (await env.KV.get(`model:${chatId}`)) || DEFAULT_MODEL_ID;

  let queueLines = '';
  if (contextQueue && contextQueue.length) {
    queueLines = contextQueue.map((q) =>
      `[msg ${q.messageId}] ${q.sender} | ${getIranTimestamp(q.date)} | ${q.text}`
    ).join('\n');
  }

  const targetTimestamp = getIranTimestamp(originalDate);

  let userMessage = '';

  if (queueLines) {
    userMessage += `[کانتکست پیام‌های گروه — فقط برای درک موقعیت، به اینها جواب نده]\n${queueLines}\n\n`;
  }

  userMessage += `[پیام هدف — فقط به این جواب بده]\n`;
  userMessage += `فرستنده: ${originalSender}\n`;
  userMessage += `زمان: ${targetTimestamp}\n`;
  userMessage += `متن: "${originalText}"\n\n`;

  if (instruction) {
    userMessage += `[دستور ادمین — دقیقاً این رو اجرا کن]\n${instruction}\n\n`;
  }

  userMessage += `حالا فقط و فقط متن خالص جواب به «پیام هدف» رو بنویس. بدون اسم بردن، با افعال جمع، بدون اغراق.`;

  try {
    const { reply } = await runAIWithFallback(env, modelId, [
      { role: 'system', content: REPLY_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ], 500);

    if (!reply) return;

    await pushToHistory(chatId, 'user', `[${targetTimestamp}] ${originalSender}: ${originalText}`, env);
    await pushToHistory(chatId, 'assistant', reply, env);

    await sendMessage(chatId, reply, env, originalId);
  } catch (err) {
    console.error('generateReplyToMessage error:', err && err.message ? err.message : String(err));
  }
}

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
      if (reply) return { reply, modelDef };
      console.warn(`Model ${modelId} returned empty reply`);
    } catch (err) {
      lastError = err;
      console.error(`Model ${modelId} failed:`, err && err.message ? err.message : String(err));
    }
  }

  throw lastError || new Error('All models failed to respond');
}

async function replyWithAI(chatId, text, env, replyToMessageId, isGroup, senderName, messageDate) {
  const modelId = (await env.KV.get(`model:${chatId}`)) || DEFAULT_MODEL_ID;

  const history = await getHistory(chatId, env);
  const timestamp = getIranTimestamp(messageDate);
  const userContent = isGroup ? `[${timestamp}] ${senderName}: ${text}` : `[${timestamp}] ${text}`;
  history.push({ role: 'user', content: userContent });

  const systemPrompt = buildSystemPrompt(isGroup);

  try {
    const { reply } = await runAIWithFallback(env, modelId, [
      { role: 'system', content: systemPrompt },
      ...history,
    ]);

    if (isGroup) {
      const trimmed = reply.trim();

      if (trimmed.includes(DELETE_MARKER)) {
        const warningText = trimmed.replace(DELETE_MARKER, '').trim();
        if (warningText) await sendMessage(chatId, warningText, env, replyToMessageId);
        await deleteMessage(chatId, replyToMessageId, env);
        history.pop();
        await saveHistory(chatId, history, env);
        return;
      }

      if (trimmed === NO_REPLY_MARKER || trimmed.includes(NO_REPLY_MARKER)) {
        const cleaned = trimmed.replace(NO_REPLY_MARKER, '').trim();
        if (!cleaned) {
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
    console.error('AI run error:', err && err.message ? err.message : String(err));
    await sendMessage(chatId, '⚠️ الان نتونستم جواب بدم.', env, replyToMessageId);
  }
}

function extractText(result) {
  if (!result) return null;
  if (typeof result.response === 'string' && result.response.trim()) return stripThinking(result.response);
  if (Array.isArray(result.choices) && result.choices.length) {
    const msg = result.choices[0].message;
    if (msg && typeof msg.content === 'string' && msg.content.trim()) return stripThinking(msg.content);
  }
  if (Array.isArray(result.output)) {
    for (const item of result.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        const part = item.content.find((c) => c.type === 'output_text' || c.type === 'text');
        if (part && part.text) return stripThinking(part.text);
      }
    }
  }
  if (typeof result.result === 'string' && result.result.trim()) return stripThinking(result.result);
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
  await env.KV.put(`history:${chatId}`, JSON.stringify(trimmed), { expirationTtl: HISTORY_TTL });
}

async function pushToHistory(chatId, role, content, env) {
  const history = await getHistory(chatId, env);
  history.push({ role, content });
  await saveHistory(chatId, history, env);
}

async function sendMessage(chatId, text, env, replyToMessageId = null) {
  const body = { chat_id: chatId, text };
  if (replyToMessageId) body.reply_to_message_id = replyToMessageId;
  try {
    const res = await fetch(`${baleApi(env.BALE_BOT_TOKEN)}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data && data.result ? data.result.message_id : null;
  } catch (err) {
    console.error('sendMessage error:', err);
    return null;
  }
}

async function editMessageText(chatId, messageId, newText, env) {
  try {
    const res = await fetch(`${baleApi(env.BALE_BOT_TOKEN)}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: newText }),
    });
    if (!res.ok) console.error('editMessageText failed:', res.status, await res.text());
  } catch (err) {
    console.error('editMessageText error:', err && err.message ? err.message : String(err));
  }
}

async function deleteMessage(chatId, messageId, env) {
  try {
    const res = await fetch(`${baleApi(env.BALE_BOT_TOKEN)}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
    if (!res.ok) console.error('deleteMessage failed:', res.status, await res.text());
  } catch (err) {
    console.error('deleteMessage error:', err && err.message ? err.message : String(err));
  }
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
  await fetch(`${baleApi(env.BALE_BOT_TOKEN)}/sendPhoto`, { method: 'POST', body: form });
}

async function replyWithImage(chatId, prompt, model, env) {
  try {
    const result = await env.AI.run(model, { prompt, seed: Math.floor(Math.random() * 1000000) });
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
    await sendMessage(chatId, '⚠️ خطا در ساخت تصویر.', env);
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
