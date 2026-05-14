import { Hash } from "viem"
import { createHash } from "crypto"
import { ZeroGStorage } from "./zeroGStorage"

interface CacheEntry {
  promptHash: Hash
  modelId: string
  result: any
  attestationRef?: string
  contentHash?: Hash
  timestamp: number
  accessCount: number
}

export class CacheLayer {
  private memoryCache: Map<string, CacheEntry> = new Map()
  private storage: ZeroGStorage
  private connected = false
  private quiet: boolean = false

  constructor(storageEndpoint?: string, quiet?: boolean) {
    this.quiet = quiet || false
    this.storage = new ZeroGStorage({
      endpoint: storageEndpoint || "https://storage.0g.ai",
      quiet: this.quiet
    })
  }

  private log(...args: any[]): void {
    if (!this.quiet) console.log(...args)
  }

  async connect(): Promise<void> {
    const healthy = await this.storage.connect()
    this.connected = healthy
    this.log("  Cache layer connected (" + this.storage.getStats().activeNodes + " storage nodes)")
  }

  async lookup(promptHash: Hash, modelId: string): Promise<CacheEntry | null> {
    const key = this.cacheKey(promptHash, modelId)

    const memCached = this.memoryCache.get(key)
    if (memCached) {
      memCached.accessCount++
      this.log("    Memory cache hit (access #" + memCached.accessCount + ")")
      return memCached
    }

    if (this.connected) {
      try {
        const contentHash = this.computeContentHash(promptHash, modelId)
        const stored = await this.storage.retrieveInference(contentHash)
        
        if (stored) {
          this.log("    0G Storage hit!")
          const entry: CacheEntry = {
            promptHash: stored.metadata.promptHash as Hash,
            modelId: stored.metadata.modelId,
            result: stored.result,
            attestationRef: stored.metadata.attestationRef,
            contentHash: contentHash,
            timestamp: stored.metadata.timestamp,
            accessCount: 1
          }
          this.memoryCache.set(key, entry)
          return entry
        }
      } catch (err) {
        // Storage miss
      }
    }

    return null
  }

  async store(entry: Omit<CacheEntry, "accessCount">): Promise<string> {
    const key = this.cacheKey(entry.promptHash, entry.modelId)
    const fullEntry: CacheEntry = { ...entry, accessCount: 0 }
    this.memoryCache.set(key, fullEntry)

    if (this.connected) {
      try {
        const receipt = await this.storage.storeInference({
          modelId: entry.modelId,
          promptHash: entry.promptHash,
          result: entry.result,
          attestationRef: entry.attestationRef
        })
        fullEntry.contentHash = receipt.contentHash
        this.log("    Persisted to 0G Storage: " + receipt.contentHash.slice(0, 16) + "...")
        return receipt.contentHash
      } catch (err) {
        this.log("    Storage persistence failed — memory-only cache")
      }
    }

    return this.computeContentHash(entry.promptHash, entry.modelId)
  }

  async getProof(contentHash: Hash): Promise<any> {
    if (this.connected) {
      const stored = await this.storage.retrieveInference(contentHash)
      if (stored?.metadata.attestationRef) {
        return stored.metadata.attestationRef
      }
    }
    return null
  }

  getStats() {
    return {
      memoryEntries: this.memoryCache.size,
      storageConnected: this.connected,
      storageStats: this.storage.getStats()
    }
  }

  private cacheKey(promptHash: Hash, modelId: string): string {
    return createHash("sha256").update(modelId + ":" + promptHash).digest("hex")
  }

  private computeContentHash(promptHash: Hash, modelId: string): Hash {
    return "0x" + createHash("sha256")
      .update("inference:" + modelId + ":" + promptHash)
      .digest("hex") as Hash
  }
}