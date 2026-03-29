import type { EmbeddingConfig } from '../types.js';
import type { EmbeddingProvider } from './provider.js';

export class OpenAIProvider implements EmbeddingProvider {
  name = 'openai';
  model: string;
  private baseUrl: string;
  private apiKey: string;

  constructor(config: EmbeddingConfig) {
    this.model = config.model;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? '';
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!res.ok) {
      throw new Error(
        `OpenAI embedding request failed: ${res.status} ${await res.text()}`,
      );
    }

    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    if (!json.data?.[0]?.embedding) {
      throw new Error('OpenAI returned unexpected embedding response');
    }
    return json.data[0].embedding;
  }
}
