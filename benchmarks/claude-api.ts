import Anthropic from '@anthropic-ai/sdk';

export interface APICallMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
}

export class ClaudeAPI {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  async callWithMetrics(
    systemPrompt: string,
    userMessage: string,
  ): Promise<{ response: string; metrics: APICallMetrics }> {
    const startTime = performance.now();

    const response = await this.client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const latencyMs = performance.now() - startTime;

    const textContent = response.content.find(c => c.type === 'text');
    const text = textContent && textContent.type === 'text' ? textContent.text : '';

    const metrics: APICallMetrics = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      latencyMs,
    };

    return { response: text, metrics };
  }

  // Run 3 times and average metrics to reduce variance
  async callWithRetries(
    systemPrompt: string,
    userMessage: string,
    retries: number = 3,
  ): Promise<{ response: string; metrics: APICallMetrics }> {
    const allMetrics: APICallMetrics[] = [];
    const allResponses: string[] = [];

    for (let i = 0; i < retries; i++) {
      console.log(`  Attempt ${i + 1}/${retries}...`);
      const result = await this.callWithMetrics(systemPrompt, userMessage);
      allMetrics.push(result.metrics);
      allResponses.push(result.response);

      // Small delay between retries to avoid rate limiting
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Use first response (all should be similar given same input)
    const response = allResponses[0];

    // Average metrics across retries
    const avgMetrics: APICallMetrics = {
      inputTokens: Math.round(
        allMetrics.reduce((sum, m) => sum + m.inputTokens, 0) / retries,
      ),
      outputTokens: Math.round(
        allMetrics.reduce((sum, m) => sum + m.outputTokens, 0) / retries,
      ),
      totalTokens: 0,
      latencyMs:
        allMetrics.reduce((sum, m) => sum + m.latencyMs, 0) / retries,
    };
    avgMetrics.totalTokens = avgMetrics.inputTokens + avgMetrics.outputTokens;

    return { response, metrics: avgMetrics };
  }
}
