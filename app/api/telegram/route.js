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

  const text = body.message.text;
  if (!text) {
    await sendMessage(chatId, "❌ নিউজ লেখা পাঠান");
    return NextResponse.json({ ok: true });
  }

  const reporterName =
    body.message.from.first_name +
    (body.message.from.last_name ? " " + body.message.from.last_name : "");
  const reporterId = String(body.message.from.id);

  try {
    // 1️⃣ Rewrite + SEO
    const seo = await generateSEO(text);

    // 2️⃣ Duplicate check
    const isDuplicate = await checkDuplicate(seo.title);
    if (isDuplicate) {
      await sendMessage(chatId, "⚠️ এই নিউজ আগে পোস্ট হয়েছে");
      return NextResponse.json({ ok: true });
    }

    // 3️⃣ Category detect
    const categoryId = await detectCategory(seo.title + " " + seo.content);

    // 4️⃣ Trusted reporter?
    const trusted = process.env.TRUSTED_REPORTERS
      ?.split(",")
      .includes(reporterId);

    // 5️⃣ Create post
    await createWPPost({
      title: seo.title,
      content: seo.content + `\n\nপ্রতিবেদন: ${reporterName}`,
      slug: seo.slug,
      excerpt: seo.excerpt,
      meta_title: seo.meta_title,
      meta_description: seo.meta_description,
      meta_keywords: seo.meta_keywords,
      status: trusted ? "publish" : "draft",
      category: categoryId,
    });

    await sendMessage(
      chatId,
      trusted
        ? "✅ নিউজ সরাসরি প্রকাশ হয়েছে"
        : "✅ নিউজ draft হিসেবে জমা হয়েছে"
    );
  } catch (e) {
    console.error(e);
    await sendMessage(chatId, "❌ ERROR:\n" + e.message);
  }

  return NextResponse.json({ ok: true });
}

/* ---------------- HELPERS ---------------- */

async function sendMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function generateSEO(newsText) {
  const prompt = `
তুমি একজন বাংলা নিউজ এডিটর ও SEO এক্সপার্ট।

কাঁচা নিউজটি নতুনভাবে রিরাইট করো:
- লেখা বড় করো
- ভাষা প্রফেশনাল করো
- plagiarism-safe রাখো

শুধু নিচের JSON দাও:

{
  "title": "",
  "content": "",
  "meta_title": "",
  "meta_description": "",
  "meta_keywords": [],
  "slug": "",
  "excerpt": ""
}

Rules:
- meta_title ≤ 60 chars
- meta_description ≤ 160 chars
- meta_keywords 5–7
- slug ছোট, english-bangla mixed

নিউজ:
${newsText}
`;

  const res = await fetch(GEMINI_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 900 },
    }),
  });

  const data = await res.json();
  if (!data.candidates?.length) {
    throw new Error("Gemini response empty");
  }

  return extractJSON(data.candidates[0].content.parts[0].text);
}

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON parse failed");
  return JSON.parse(match[0]);
}

async function checkDuplicate(title) {
  const auth = getAuth();
  const res = await fetch(
    `${process.env.WP_SITE}/wp-json/wp/v2/posts?search=${encodeURIComponent(
      title
    )}&per_page=1`,
    { headers: { Authorization: auth } }
  );
  const posts = await res.json();
  return posts.length > 0;
}

async function detectCategory(text) {
  const map = {
    "crime": ["খুন", "মামলা", "গ্রেপ্তার", "পুলিশ"],
    "sports": ["খেলা", "ম্যাচ", "গোল", "টুর্নামেন্ট"],
    "politics": ["নির্বাচন", "মন্ত্রী", "সংসদ", "দল"],
  };

  for (const [slug, words] of Object.entries(map)) {
    if (words.some((w) => text.includes(w))) {
      return await getCategoryId(slug);
    }
  }
  return await getCategoryId("news");
}

async function getCategoryId(slug) {
  const auth = getAuth();
  const res = await fetch(
    `${process.env.WP_SITE}/wp-json/wp/v2/categories?slug=${slug}`,
    { headers: { Authorization: auth } }
  );
  const data = await res.json();
  return data[0]?.id || 1;
}

async function createWPPost(post) {
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
      status: post.status,
      categories: [post.category],
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
