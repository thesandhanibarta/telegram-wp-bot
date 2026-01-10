export async function generateSEO(news) {
  const prompt = `
Follow instructions strictly.

Return ONLY valid JSON:
{
  "title": "",
  "meta_description": "",
  "tags": [],
  "slug": ""
}

Rules:
- Bangla SEO title
- Meta description max 160 chars
- 5–7 Bangla tags
- English slug

News:
${news}
`;

  const res = await fetch(
    `https://backend.buildpicoapps.com/aero/run/llm-api?pk=${process.env.PICO_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    }
  );

  const data = await res.json();
  return JSON.parse(data.text);
}
