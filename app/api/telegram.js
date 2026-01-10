import { generateSEO } from "./generateSeo.js";
import { createPost } from "./wordpress.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).end();

  const msg = req.body.message;
  if (!msg?.caption || !msg.photo) return res.status(200).end();

  const newsText = msg.caption;

  const seo = await generateSEO(newsText);

  await createPost({
    title: seo.title,
    content: `<p>${newsText}</p>`,
    seo
  });

  res.status(200).json({ ok: true });
}
