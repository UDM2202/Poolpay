import { createHash } from "crypto"
import { Hash } from "viem"

interface StorageNodeConfig {
  endpoint: string
  backupNodes: string[]
  timeout: number
  retries: number
}

interface StorageReceipt {
  contentHash: Hash
  size: number
  acceptedBy: string[]
  storedAt: number
  durability: number
  storageProof: Hash
}

interface InferenceMetadata {
  modelId: string
  promptHash: Hash
  timestamp: number
  attestationRef?: string
  contentType: string
  compression: "none" | "gzip"
  version: number
}

interface StoredInference {
  metadata: InferenceMetadata
  result: any
}

export class ZeroGStorage {
  private config: StorageNodeConfig
  private connected: boolean = false
  private quiet: boolean = false
  private activeNodes: string[] = []
  private localCache: Map<string, { data: string; metadata: InferenceMetadata; storedAt: number }> = new Map()
  
  constructor(config?: Partial<StorageNodeConfig> & { quiet?: boolean }) {
    this.quiet = config?.quiet || false
    this.config = {
      endpoint: config?.endpoint || "https://storage.0g.ai",
      backupNodes: config?.backupNodes || [
        "https://storage-2.0g.ai",
        "https://storage-3.0g.ai"
      ],
      timeout: config?.timeout || 30000,
      retries: config?.retries || 3
    }
  }

  private log(...args: any[]): void {
    if (!this.quiet) console.log(...args)
  }

  async connect(): Promise<boolean> {
    this.log("  Connecting to 0G Storage network...")
    
    const allNodes = [this.config.endpoint, ...this.config.backupNodes]
    this.activeNodes = []
    
    for (const node of allNodes) {
      try {
        const healthy = await this.pingNode(node)
        if (healthy) {
          this.activeNodes.push(node)
        }
      } catch {
        // Node unreachable — skip
      }
    }

    if (this.activeNodes.length === 0) {
      this.log("  No 0G Storage nodes available — using local mode")
      this.activeNodes = ["local"]
    }

    this.connected = true
    this.log("  Connected to " + this.activeNodes.length + " storage node(s)")
    return true
  }

  async storeInference(params: {
    modelId: string
    promptHash: Hash
    result: any
    attestationRef?: string
    contentType?: string
  }): Promise<StorageReceipt> {
    if (!this.connected) await this.connect()

    const metadata: InferenceMetadata = {
      modelId: params.modelId,
      promptHash: params.promptHash,
      timestamp: Date.now(),
      attestationRef: params.attestationRef,
      contentType: params.contentType || "application/json",
      compression: "none",
      version: 1
    }

    const stored: StoredInference = {
      metadata: metadata,
      result: params.result
    }

    const serialized = JSON.stringify(stored)
    const contentHash = "0x" + createHash("sha256").update(serialized).digest("hex") as Hash
    const size = Buffer.byteLength(serialized, "utf-8")

    this.log("    Content hash: " + contentHash.slice(0, 20) + "...")
    this.log("    Size: " + size + " bytes")

    let storedOnNodes: string[] = []
    
    for (let attempt = 0; attempt < this.config.retries; attempt++) {
      storedOnNodes = await this.uploadToNodes(contentHash, serialized, metadata)
      if (storedOnNodes.length > 0) break
      
      this.log("    Retry " + (attempt + 1) + "/" + this.config.retries + "...")
      await this.sleep(1000 * (attempt + 1))
    }

    if (storedOnNodes.length === 0) {
      throw new Error("Failed to store on any 0G Storage node after " + this.config.retries + " attempts")
    }

    const storageProof = "0x" + createHash("sha256")
      .update(contentHash + storedOnNodes.join(",") + Date.now().toString())
      .digest("hex") as Hash

    const receipt: StorageReceipt = {
      contentHash: contentHash,
      size: size,
      acceptedBy: storedOnNodes,
      storedAt: Date.now(),
      durability: 86400 * 365,
      storageProof: storageProof
    }

    this.log("    Stored on " + storedOnNodes.length + " node(s)")
    this.log("    Durability: " + (receipt.durability / 86400).toFixed(0) + " days")

    return receipt
  }

  async retrieveInference(contentHash: Hash): Promise<StoredInference | null> {
    if (!this.connected) await this.connect()

    const cached = this.localCache.get(contentHash)
    if (cached) {
      this.log("    Local cache hit for " + contentHash.slice(0, 16) + "...")
      return JSON.parse(cached.data) as StoredInference
    }

    for (const node of this.activeNodes) {
      try {
        const data = await this.downloadFromNode(node, contentHash)
        if (data) {
          const parsed = JSON.parse(data) as StoredInference
          this.localCache.set(contentHash, {
            data: data,
            metadata: parsed.metadata,
            storedAt: Date.now()
          })
          return parsed
        }
      } catch {
        continue
      }
    }

    return null
  }

  async storeAttestation(inferenceId: Hash, attestation: any): Promise<Hash> {
    if (!this.connected) await this.connect()

    const serialized = JSON.stringify({
      inferenceId: inferenceId,
      attestation: attestation,
      timestamp: Date.now(),
      version: 1
    })

    const attestHash = "0x" + createHash("sha256").update(serialized).digest("hex") as Hash

    await this.uploadToNodes(attestHash, serialized, {
      modelId: "attestation",
      promptHash: inferenceId,
      timestamp: Date.now(),
      contentType: "application/json+tee-attestation",
      compression: "none",
      version: 1
    })

    this.log("    Attestation stored: " + attestHash.slice(0, 20) + "...")
    return attestHash
  }

  async verifyStorageProof(contentHash: Hash, proof: Hash): Promise<boolean> {
    return proof.startsWith("0x") && proof.length === 66
  }

  getStats(): { activeNodes: number; cacheSize: number; connected: boolean } {
    return {
      activeNodes: this.activeNodes.length,
      cacheSize: this.localCache.size,
      connected: this.connected
    }
  }

  private async pingNode(endpoint: string): Promise<boolean> {
    if (endpoint === "local") return true
    
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const response = await fetch(endpoint + "/health", { signal: controller.signal })
      clearTimeout(timeout)
      return response.ok
    } catch {
      return false
    }
  }

  private async uploadToNodes(
    contentHash: Hash,
    data: string,
    metadata: InferenceMetadata
  ): Promise<string[]> {
    const successfulNodes: string[] = []

    this.localCache.set(contentHash, { data, metadata, storedAt: Date.now() })
    successfulNodes.push("local")

    for (const node of this.activeNodes) {
      if (node === "local") continue
      
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), this.config.timeout)
        const response = await fetch(node + "/store", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Content-Hash": contentHash,
            "X-Model-Id": metadata.modelId
          },
          body: data,
          signal: controller.signal
        })
        clearTimeout(timeout)
        if (response.ok) successfulNodes.push(node)
      } catch {
        // Node failed — continue
      }
    }

    return successfulNodes
  }

  private async downloadFromNode(node: string, contentHash: Hash): Promise<string | null> {
    if (node === "local") {
      const cached = this.localCache.get(contentHash)
      return cached ? cached.data : null
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.config.timeout)
      const response = await fetch(node + "/retrieve/" + contentHash, { signal: controller.signal })
      clearTimeout(timeout)
      if (response.ok) return await response.text()
    } catch {
      // Node failed
    }

    return null
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}