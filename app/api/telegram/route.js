import { NextResponse } from "next/server";

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";

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
    await createWPPost(seo);
    await sendMessage(chatId, "✅ নিউজ WordPress-এ draft হয়েছে");
  } catch (e) {
    console.error(e);
    await sendMessage(chatId, "❌ ERROR: " + e.message);
  }

  return NextResponse.json({ ok: true });
}

/* ---------------- TELEGRAM ---------------- */

async function sendMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

/* ---------------- AI CONTROLLER ---------------- */

async function generateSEO(newsText) {
  // 1️⃣ Try Gemini
  try {
    const gemini = await geminiRewrite(newsText);
    if (gemini) return gemini;
  } catch {}

  // 2️⃣ Try OpenRouter
  try {
    const or = await openRouterRewrite(newsText);
    if (or) return or;
  } catch {}

  // 3️⃣ Guaranteed fallback
  return fallbackSEO(newsText);
}

/* ---------------- GEMINI ---------------- */

async function geminiRewrite(text) {
  const prompt = buildPrompt(text);

  const res = await fetch(GEMINI_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 900 },
    }),
  });

  const data = await res.json();
  if (!data?.candidates?.length) return null;

  return extractJSON(data.candidates[0].content.parts[0].text);
}

/* ---------------- OPENROUTER ---------------- */

async function openRouterRewrite(text) {
  const prompt = buildPrompt(text);

  const res = await fetch(OPENROUTER_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://your-site.com",
      "X-Title": "Telegram News Bot",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    }),
  });

  const data = await res.json();
  if (!data?.choices?.length) return null;

  return extractJSON(data.choices[0].message.content);
}

/* ---------------- PROMPT ---------------- */

function buildPrompt(newsText) {
  return `
তুমি একজন অভিজ্ঞ বাংলা নিউজ এডিটর।

কাঁচা নিউজটি নতুনভাবে রিরাইট করো:
- লেখা বড় করো
- প্রফেশনাল নিউজ স্টাইল
- plagiarism-safe
- তথ্য পরিবর্তন করা যাবে না

শুধু JSON দেবে:

{
 "title":"",
 "content":"",
 "meta_title":"",
 "meta_description":"",
 "meta_keywords":[],
 "slug":"",
 "excerpt":""
}

নিউজ:
${newsText}
`;
}

/* ---------------- HELPERS ---------------- */

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON parse failed");
  return JSON.parse(match[0]);
}

function fallbackSEO(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  const intro = clean.split("।")[0];

  return {
    title: intro || "আজকের সংবাদ",
    content:
      clean +
      "\n\n(এই প্রতিবেদনটি স্বয়ংক্রিয়ভাবে সম্পাদিত ও প্রকাশিত)",
    meta_title: intro.slice(0, 60),
    meta_description: clean.slice(0, 160),
    meta_keywords: ["বাংলাদেশ", "রাজনীতি", "সর্বশেষ সংবাদ"],
    slug: "news-" + Date.now(),
    excerpt: clean.slice(0, 120),
  };
}

/* ---------------- WORDPRESS ---------------- */

async function createWPPost(post) {
  const auth =
    "Basic " +
    Buffer.from(
      `${process.env.WP_USERNAME}:${process.env.WP_APP_PASSWORD}`
    ).toString("base64");

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
      meta: {
        rank_math_title: post.meta_title,
        rank_math_description: post.meta_description,
        rank_math_focus_keyword: post.meta_keywords.join(", "),
      },
    }),
  });
}
