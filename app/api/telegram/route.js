import { NextResponse } from "next/server";

/* ================= CONFIG ================= */

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";

/* ================= MAIN ================= */

export async function POST(req) {
  const body = await req.json();
  if (!body.message) return NextResponse.json({ ok: true });

  const chatId = body.message.chat.id;
  if (String(chatId) !== process.env.ALLOWED_CHAT_ID) {
    return NextResponse.json({ ok: true });
  }

  const rawText = body.message.text;
  if (!rawText) {
    await sendMessage(chatId, "❌ নিউজ লেখা পাঠান");
    return NextResponse.json({ ok: true });
  }

  try {
    const seo = await generateSEO(rawText);
    const categoryId = await detectCategory(seo.title + " " + seo.content);
    await createWPPost(seo, categoryId);
    await sendMessage(chatId, "✅ নিউজ সফলভাবে WordPress-এ Draft হয়েছে");
  } catch (e) {
    console.error(e);
    await sendMessage(chatId, "❌ ERROR: " + e.message);
  }

  return NextResponse.json({ ok: true });
}

/* ================= TELEGRAM ================= */

async function sendMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

/* ================= AI CONTROLLER ================= */

async function generateSEO(newsText) {
  // 1️⃣ Gemini
  try {
    const g = await geminiRewrite(newsText);
    if (g && !isEnglish(g.content)) return g;
  } catch {}

  // 2️⃣ OpenRouter
  try {
    const o = await openRouterRewrite(newsText);
    if (o && !isEnglish(o.content)) return o;
  } catch {}

  // 3️⃣ Fallback (never fails)
  return fallbackSEO(newsText);
}

/* ================= PROMPT ================= */

function buildPrompt(newsText) {
  return `
তুমি একজন অভিজ্ঞ **বাংলা** নিউজ এডিটর।

⚠️ বাধ্যতামূলক নির্দেশনা:
- আউটপুট ১০০% বাংলায় হবে
- কোনো ইংরেজি শব্দ ব্যবহার করা যাবে না
- নিউজ স্টাইল হবে নিরপেক্ষ ও পেশাদার

কাঁচা নিউজটি নতুনভাবে রিরাইট করো:
- লেখা বড় করো
- ভাষা উন্নত করো
- plagiarism-safe
- তথ্য পরিবর্তন করা যাবে না

শুধু নিচের JSON দেবে:

{
 "title": "",
 "content": "",
 "meta_title": "",
 "meta_description": "",
 "meta_keywords": [],
 "slug": "",
 "excerpt": ""
}

নিউজ:
${newsText}
`;
}

/* ================= GEMINI ================= */

async function geminiRewrite(text) {
  const res = await fetch(GEMINI_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(text) }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 900 },
    }),
  });

  const data = await res.json();
  if (!data?.candidates?.length) return null;
  return extractJSON(data.candidates[0].content.parts[0].text);
}

/* ================= OPENROUTER ================= */

async function openRouterRewrite(text) {
  const res = await fetch(OPENROUTER_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": process.env.WP_SITE,
      "X-Title": "Telegram News Bot",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL,
      messages: [{ role: "user", content: buildPrompt(text) }],
      temperature: 0.2,
    }),
  });

  const data = await res.json();
  if (!data?.choices?.length) return null;
  return extractJSON(data.choices[0].message.content);
}

/* ================= HELPERS ================= */

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON parse failed");
  return JSON.parse(match[0]);
}

function isEnglish(text) {
  return /^[\x00-\x7F]*$/.test(text.replace(/[0-9\s\-_,.]/g, ""));
}

/* ================= FALLBACK ================= */

function fallbackSEO(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  const first = clean.split("।")[0];

  return {
    title: first || "আজকের সংবাদ",
    content:
      clean +
      "\n\nউল্লেখ্য, সংশ্লিষ্ট ঘটনাটি স্থানীয়ভাবে আলোচনার সৃষ্টি করেছে।",
    meta_title: first.slice(0, 60),
    meta_description: clean.slice(0, 160),
    meta_keywords: [
      "বাংলাদেশ",
      "আজকের খবর",
      "সর্বশেষ সংবাদ",
      "স্থানীয় সংবাদ",
    ],
    slug: "news-" + Date.now(),
    excerpt: clean.slice(0, 120),
  };
}

/* ================= CATEGORY ================= */

async function detectCategory(text) {
  const map = {
    "রাজনীতি": ["বিএনপি", "আওয়ামী", "নির্বাচন", "মন্ত্রী", "সংসদ", "রাজনীতি"],
    "অপরাধ": ["খুন", "মামলা", "গ্রেপ্তার", "পুলিশ", "র‍্যাব"],
    "খেলা": ["খেলা", "ম্যাচ", "ক্রিকেট", "ফুটবল"],
    "চাকরি": ["নিয়োগ", "চাকরি", "পরীক্ষা"],
    "বিনোদন": ["চলচ্চিত্র", "নাটক", "অভিনেতা", "গান"],
    "বাণিজ্য": ["বাজার", "দাম", "ব্যবসা", "অর্থনীতি"],
    "জীবনযাপন": ["স্বাস্থ্য", "শিক্ষা", "জীবনযাপন"],
    "বিশ্ব": ["আন্তর্জাতিক", "বিদেশ", "বিশ্ব"],
    "মতামত": ["মতামত", "বিশ্লেষণ"],
  };

  for (const [cat, words] of Object.entries(map)) {
    if (words.some(w => text.includes(w))) {
      return await getCategoryIdByName(cat);
    }
  }
  return await getCategoryIdByName("বাংলাদেশ");
}

async function getCategoryIdByName(name) {
  const auth = getAuth();
  const res = await fetch(
    `${process.env.WP_SITE}/wp-json/wp/v2/categories?search=${encodeURIComponent(name)}`,
    { headers: { Authorization: auth } }
  );
  const data = await res.json();
  return data[0]?.id || 1;
}

/* ================= WORDPRESS ================= */

async function createWPPost(post, categoryId) {
  const auth = getAuth();

  await fetch(`${process.env.WP_SITE}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: auth,
    },
    body: JSON.stringify({
      title: post.title,
      content: post.content,
      slug: post.slug,
      excerpt: post.excerpt,
      status: "draft",
      categories: [categoryId],
      meta: {
        rank_math_title: post.meta_title,
        rank_math_description: post.meta_description,
        rank_math_focus_keyword: post.meta_keywords.join(", "),
      },
    }),
  });
}

function getAuth() {
  return (
    "Basic " +
    Buffer.from(
      `${process.env.WP_USERNAME}:${process.env.WP_APP_PASSWORD}`
    ).toString("base64")
  );
}
