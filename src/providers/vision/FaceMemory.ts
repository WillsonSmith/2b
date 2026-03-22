import { type PersonRecord } from "./types.ts";
import { writeFile } from "node:fs/promises";
import { logger } from "../../logger.ts";

export class FaceMemory {
  private records: PersonRecord[] = [];

  constructor(private memoryPath: string = "./face-memory.json") {}

  async load() {
    if (await Bun.file(this.memoryPath).exists()) {
      const data = await Bun.file(this.memoryPath).json();
      
      const loadedRecords = data.map((record: any) => {
        if (record.embedding && !record.embeddings) {
          record.embeddings = [record.embedding];
          delete record.embedding;
        }
        return record;
      });

      // Merge duplicate records by name
      const mergedMap = new Map<string, typeof loadedRecords[0]>();
      for (const record of loadedRecords) {
        if (mergedMap.has(record.name)) {
          const existing = mergedMap.get(record.name);
          existing.embeddings.push(...record.embeddings);
          existing.seenCount += record.seenCount || 1;
        } else {
          mergedMap.set(record.name, record);
        }
      }
      this.records = Array.from(mergedMap.values());
      
      logger.info("FaceMemory", `Loaded ${this.records.length} known profiles.`);
    }
  }

  async save() {
    await writeFile(this.memoryPath, JSON.stringify(this.records, null, 2));
  }

  enroll(name: string, embedding: Float32Array) {
    const cleanName = name.trim();
    const existing = this.records.find((r) => r.name === cleanName);
    
    if (existing) {
      this.addEmbedding(cleanName, embedding);
      return;
    }

    const now = new Date().toISOString();
    this.records.push({
      name: cleanName,
      embeddings: [Array.from(embedding)],
      firstSeen: now,
      lastSeen: now,
      seenCount: 1,
    });
  }

  addEmbedding(name: string, embedding: Float32Array, maxEmbeddings = 10) {
    const record = this.records.find((r) => r.name === name);
    if (record) {
      // Avoid adding near-identical embeddings by checking similarity
      let isNovelEnough = true;
      for (const existing of record.embeddings) {
        if (this.cosineSimilarity(embedding, new Float32Array(existing)) > 0.95) {
          isNovelEnough = false;
          break;
        }
      }

      if (isNovelEnough) {
        record.embeddings.push(Array.from(embedding));
        // Keep the most recent `maxEmbeddings`
        if (record.embeddings.length > maxEmbeddings) {
          record.embeddings.shift();
        }
        // Save async without waiting
        this.save().catch((e) => logger.error("FaceMemory", "Failed to save:", e));
      }
    }
  }

  updateLastSeen(name: string) {
    const record = this.records.find((r) => r.name === name);
    if (record) {
      record.lastSeen = new Date().toISOString();
      record.seenCount++;
    }
  }

  findMatch(currentEmbedding: Float32Array, threshold = 0.55) {
    let bestMatch = { name: "Unknown", score: 0 };
    for (const record of this.records) {
      for (const existingEmbedding of record.embeddings) {
        const similarity = this.cosineSimilarity(
          currentEmbedding,
          new Float32Array(existingEmbedding),
        );
        if (similarity > bestMatch.score) {
          bestMatch = { name: record.name, score: similarity };
        }
      }
    }
    return bestMatch.score >= threshold
      ? bestMatch
      : { name: "Unknown", score: bestMatch.score };
  }

  private cosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
    let dotProduct = 0,
      mA = 0,
      mB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i]! * vecB[i]!;
      mA += vecA[i]! * vecA[i]!;
      mB += vecB[i]! * vecB[i]!;
    }
    return dotProduct / (Math.sqrt(mA) * Math.sqrt(mB));
  }
}
