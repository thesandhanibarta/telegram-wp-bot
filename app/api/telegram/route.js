import { NextResponse } from "next/server";

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

export async function POST(req) {
  const body = await req.json();
  if (!body.message) return NextResponse.json({ ok: true });

  const chatId = body.message.chat.id;

  // 🔐 Allow only your group
  if (String(chatId) !== process.env.ALLOWED_CHAT_ID) {
    return NextResponse.json({ ok: true });
  }

  const text = body.message.text;
  if (!text) {
    await sendMessage(chatId, "❌ নিউজ লেখা পাঠান (text required)");
    return NextResponse.json({ ok: true });
  }

  try {
    // 1️⃣ Gemini SEO
    const seo = await generateSEO(text);

    // 2️⃣ WordPress Draft
    await createWPPost({
      title: seo.title,
      content: text,
      slug: seo.slug,
      excerpt: seo.excerpt,
      tags: seo.tags,
      meta_title: seo.meta_title,
      meta_description: seo.meta_description,
    });

    await sendMessage(chatId, "✅ নিউজ WordPress-এ draft হিসেবে চলে গেছে");
    } catch (e) {
    console.error(e);
    await sendMessage(chatId, "❌ ERROR:\n" + e.message);
  }


  return NextResponse.json({ ok: true });
}

// ---------------- HELPERS ----------------

async function sendMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function generateSEO(newsText) {
  const prompt = `
তুমি একজন বাংলা নিউজ পোর্টালের SEO এডিটর।

নিচের নিউজ থেকে STRICT JSON আকারে দাও:
{
  "title": "",
  "meta_title": "",
  "meta_description": "",
  "slug": "",
  "tags": [],
  "excerpt": ""
}

Rules:
- meta_title max 60 characters
- meta_description max 160 characters
- slug english-bangla mixed, hyphen-separated
- tags 5-7

নিউজ:
${newsText}
`;

  const res = await fetch(GEMINI_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
    }),
  });

  const data = await res.json();
  const textOutput = data.candidates[0].content.parts[0].text;

  return JSON.parse(textOutput);
}

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
      },
    }),
  });
}
