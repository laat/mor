import type { EmbeddingConfig } from '../types.js';
import type { EmbeddingProvider } from './provider.js';

export class AzureOpenAIProvider implements EmbeddingProvider {
  name = 'azure-openai';
  model: string;
  private baseUrl: string;
  private deployment: string;
  private apiVersion: string;
  private apiKey: string;

  constructor(config: EmbeddingConfig) {
    this.model = config.model;
    if (!config.baseUrl)
      throw new Error('Azure OpenAI requires baseUrl in embedding config');
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.deployment = config.deployment ?? config.model;
    this.apiVersion = config.apiVersion ?? '2024-10-21';
    this.apiKey =
      config.apiKey ??
      process.env.AZURE_OPENAI_API_KEY ??
      process.env.OPENAI_API_KEY ??
      '';
  }

  async embed(text: string): Promise<number[]> {
    const url = `${this.baseUrl}/openai/deployments/${this.deployment}/embeddings?api-version=${this.apiVersion}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.apiKey,
      },
      body: JSON.stringify({ input: text }),
    });

    if (!res.ok) {
      throw new Error(
        `Azure OpenAI embedding request failed: ${res.status} ${await res.text()}`,
      );
    }

    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    if (!json.data?.[0]?.embedding) {
      throw new Error('Azure OpenAI returned unexpected embedding response');
    }
    return json.data[0].embedding;
  }
}
