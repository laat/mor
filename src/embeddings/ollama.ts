import type { EmbeddingConfig } from '../types.js';
import type { EmbeddingProvider } from './provider.js';

export class OllamaProvider implements EmbeddingProvider {
  name = 'ollama';
  model: string;
  private baseUrl: string;

  constructor(config: EmbeddingConfig) {
    this.model = config.model;
    this.baseUrl = (config.baseUrl ?? 'http://localhost:11434').replace(
      /\/$/,
      '',
    );
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    });

    if (!res.ok) {
      throw new Error(
        `Ollama embedding request failed: ${res.status} ${await res.text()}`,
      );
    }

    const json = (await res.json()) as { embedding: number[] };
    if (!json.embedding) {
      throw new Error('Ollama returned unexpected embedding response');
    }
    return json.embedding;
  }
}
