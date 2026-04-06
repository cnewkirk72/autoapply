import OpenAI from "openai";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export const EMBED_MODEL =
  process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";

/** Generate a 1536-dim embedding for arbitrary text. */
export async function embed(text: string): Promise<number[]> {
  const trimmed = text.slice(0, 8000); // ~stay under token limits
  const res = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: trimmed,
  });
  return res.data[0].embedding;
}

/** Batch embedding helper. */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: texts.map((t) => t.slice(0, 8000)),
  });
  return res.data.map((d) => d.embedding);
}
