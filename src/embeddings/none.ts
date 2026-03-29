import type { EmbeddingProvider } from './provider.js';

export class NoneProvider implements EmbeddingProvider {
  name = 'none';
  model = 'none';

  async embed(_text: string): Promise<number[]> {
    return [];
  }
}
