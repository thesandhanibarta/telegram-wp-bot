export async function createPost({ title, content, seo }) {
  const auth =
    "Basic " +
    Buffer.from(
      `${process.env.WP_USER}:${process.env.WP_APP_PASSWORD}`
    ).toString("base64");

  await fetch(`${process.env.WP_URL}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title,
      content,
      slug: seo.slug,
      status: "publish",
      meta: {
        rank_math_title: seo.title,
        rank_math_description: seo.meta_description,
        rank_math_focus_keyword: seo.tags.join(", ")
      }
    })
  });
}
