import { GeneratedDataSchema, type GeneratedData } from '@vera/types';
import generatedJson from '@/data/generated.json';

let cached: GeneratedData | null = null;

export function getData(): GeneratedData {
  if (cached) return cached;
  cached = GeneratedDataSchema.parse(generatedJson);
  return cached;
}
