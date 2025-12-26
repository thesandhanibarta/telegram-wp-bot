import { NextResponse } from "next/server";

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

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

    await sendMessage(chatId, "✅ নিউজ সফলভাবে WordPress-এ draft হয়েছে");
  } catch (e) {
    console.error(e);
    await sendMessage(chatId, "❌ ERROR: " + e.message);
  }

  return NextResponse.json({ ok: true });
}

/* ------------------ TELEGRAM ------------------ */

async function sendMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

/* ------------------ AI LOGIC ------------------ */

async function generateSEO(newsText) {
  const prompt = `
তুমি একজন অভিজ্ঞ বাংলা নিউজ এডিটর।

কাঁচা নিউজটি সম্পূর্ণ নতুনভাবে রিরাইট করো:
- লেখা বড় করো
- প্রফেশনাল নিউজ স্টাইল
- plagiarism-safe হতে হবে
- তথ্য পরিবর্তন করা যাবে না

শুধু নিচের JSON দেবে:

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

  // Retry Gemini twice
  for (let i = 0; i < 2; i++) {
    const res = await fetch(GEMINI_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 900,
        },
      }),
    });

    const data = await res.json();

    if (data?.candidates?.length) {
      try {
        const output = data.candidates[0].content.parts[0].text;
        return extractJSON(output);
      } catch {
        // retry
      }
    }
  }

  // FINAL GUARANTEED FALLBACK
  return fallbackSEO(newsText);
}

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI JSON parse failed");
  return JSON.parse(match[0]);
}

/* ------------------ FALLBACK (NEVER FAILS) ------------------ */

function fallbackSEO(text) {
  const clean = text.replace(/\n+/g, " ").trim();
  const short = clean.slice(0, 180);

  return {
    title: short.split("।")[0] || "আজকের সংবাদ",
    content:
      clean +
      "\n\n(এই প্রতিবেদনটি স্বয়ংক্রিয়ভাবে সম্পাদিত ও প্রকাশিত)",
    meta_title: short.slice(0, 60),
    meta_description: short.slice(0, 160),
    meta_keywords: ["বাংলাদেশ", "রাজনীতি", "আজকের খবর", "সর্বশেষ সংবাদ"],
    slug: "news-" + Date.now(),
    excerpt: short.slice(0, 120),
  };
}

/* ------------------ WORDPRESS ------------------ */

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
