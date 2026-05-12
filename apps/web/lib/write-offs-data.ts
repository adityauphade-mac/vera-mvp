import { WriteOffsFileSchema, type WriteOffsFile } from '@vera/types';
import writeOffsJson from '@/data/write-offs.json';

let cached: WriteOffsFile | null = null;

export function getWriteOffs(): WriteOffsFile {
  if (cached) return cached;
  cached = WriteOffsFileSchema.parse(writeOffsJson);
  return cached;
}
