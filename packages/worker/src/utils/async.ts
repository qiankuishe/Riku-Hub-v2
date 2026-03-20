/**
 * 异步工具函数
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function mapWithConcurrency<TInput, TOutput>(
  inputs: TInput[],
  concurrency: number,
  mapper: (input: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
  if (inputs.length === 0) {
    return [];
  }
  const limit = Math.max(1, Math.min(concurrency, inputs.length));
  const results = new Array<TOutput>(inputs.length);
  let nextIndex = 0;

  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= inputs.length) {
        return;
      }
      results[currentIndex] = await mapper(inputs[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}
