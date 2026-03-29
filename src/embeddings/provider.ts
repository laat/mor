import type { EmbeddingConfig } from '../types.js';
import { NoneProvider } from './none.js';
import { OllamaProvider } from './ollama.js';
import { OpenAIProvider } from './openai.js';

export interface EmbeddingProvider {
  name: string;
  model: string;
  embed(text: string): Promise<number[]>;
}

export function createProvider(config: EmbeddingConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    case 'none':
    default:
      return new NoneProvider();
  }
}
