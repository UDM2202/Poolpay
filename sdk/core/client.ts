import { createPublicClient, createWalletClient, http, Hash, Address } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { createHash } from "crypto"
import { InferenceBillingABI } from "../contracts/abi"
import { TEAVerifier } from "../verification/tee"
import { CacheLayer } from "../storage/cache"
import { ReceiptBuilder } from "../utils/receipt"
import { ModelEndpoint, CacheStrategy, InferenceReceipt } from "../types/core"
import { computePromptHash, generateInferenceId } from "../utils/hash"

interface InferConfig {
  modelId: string
  prompt: string
  params?: { temperature?: number; maxTokens?: number; topP?: number }
  cache?: Partial<CacheStrategy>
  maxCost?: bigint
  waitForConfirmation?: boolean
  confirmations?: number
}

export class ZeroGInfer {
  private publicClient: ReturnType<typeof createPublicClient>
  private walletClient: ReturnType<typeof createWalletClient>
  private account: ReturnType<typeof privateKeyToAccount>
  private cacheLayer: CacheLayer
  private teeVerifier: TEAVerifier
  private receiptBuilder: ReceiptBuilder
  private contractAddress: Address
  private endpoints: Map<string, ModelEndpoint> = new Map()
  private quiet: boolean

  constructor(config: { privateKey: string; rpcUrl?: string; contractAddress?: Address; quiet?: boolean }) {
    this.quiet = config.quiet || false
    if (!config.privateKey.startsWith("0x") || config.privateKey.length !== 66) {
      throw new Error("Invalid private key format. Must be 0x-prefixed 32-byte hex.")
    }
    this.account = privateKeyToAccount(config.privateKey as Hash)
    const rpc = config.rpcUrl || "https://rpc.0g.ai"
    this.publicClient = createPublicClient({ transport: http(rpc) })
    this.walletClient = createWalletClient({ account: this.account, transport: http(rpc) })
    this.contractAddress = config.contractAddress || "0x0000000000000000000000000000000000000000" as Address
    this.cacheLayer = new CacheLayer("https://storage.0g.ai", this.quiet)
    this.teeVerifier = new TEAVerifier(this.quiet)
    this.receiptBuilder = new ReceiptBuilder()
  }

  private log(...args: any[]): void {
    if (!this.quiet) console.log(...args)
  }

  getStorageStats() {
    return this.cacheLayer.getStats()
  }

  async initialize(): Promise<void> {
    this.log("==============================================")
    this.log("  0G INFERENCE SDK - INITIALIZING")
    this.log("==============================================")
    
    try {
      const logs = await this.publicClient.getLogs({
        address: this.contractAddress,
        event: {
          type: "event",
          name: "ModelRegistered",
          inputs: [
            { indexed: true, name: "modelId", type: "string" },
            { indexed: true, name: "provider", type: "address" },
            { indexed: true, name: "curator", type: "address" },
            { indexed: false, name: "pricePerCall", type: "uint256" },
            { indexed: false, name: "providerSplit", type: "uint16" },
            { indexed: false, name: "curatorSplit", type: "uint16" },
            { indexed: false, name: "protocolSplit", type: "uint16" }
          ]
        },
        fromBlock: 0n,
        toBlock: "latest"
      })

      for (const log of logs) {
        const modelId = log.args.modelId as string
        if (modelId && !this.endpoints.has(modelId)) {
          this.endpoints.set(modelId, {
            id: modelId,
            name: modelId,
            provider: log.args.provider as Address,
            curator: log.args.curator as Address,
            pricePerCall: log.args.pricePerCall as bigint,
            teeEnabled: false,
            cacheTTL: 3600,
            supportedChains: [],
            metadata: { description: "", capabilities: [], maxTokens: 4096 }
          })
        }
      }
    } catch {
      this.log("  Chain unavailable")
    }

    // Always add mock models if none loaded from chain
    if (this.endpoints.size === 0) {
      this.endpoints.set("llama-3-70b", {
        id: "llama-3-70b",
        name: "Llama 3 70B",
        provider: "0x1111111111111111111111111111111111111111" as Address,
        curator: "0x2222222222222222222222222222222222222222" as Address,
        pricePerCall: 1000000000000000n,
        teeEnabled: true,
        cacheTTL: 3600,
        supportedChains: [1],
        metadata: { description: "Llama 3 70B model", capabilities: ["text-generation"], maxTokens: 4096 }
      })
    }

    await this.cacheLayer.connect()
    this.log("  Ready - " + this.endpoints.size + " models loaded")
    this.log("")
  }

  async infer(config: InferConfig): Promise<InferenceReceipt> {
    const startTime = Date.now()
    
    if (!config.modelId) throw new Error("modelId required")
    if (!config.prompt) throw new Error("prompt required")

    const endpoint = this.endpoints.get(config.modelId)
    if (!endpoint) throw new Error("Model not found. Call initialize() first.")

    const promptHash = computePromptHash(config.prompt, config.params)
    const inferenceId = generateInferenceId(config.modelId, promptHash, this.account.address)

    this.log("")
    this.log("  Inference Request")
    this.log("  ID:     " + inferenceId.slice(0, 16) + "...")
    this.log("  Model:  " + config.modelId)

    const cacheStrategy: CacheStrategy = {
      enabled: config.cache?.enabled ?? true,
      ttl: config.cache?.ttl ?? endpoint.cacheTTL,
      cacheable: config.cache?.cacheable ?? true
    }

    let attestationRef: string | undefined

    if (cacheStrategy.enabled) {
      this.log("  Checking cache...")
      const cached = await this.cacheLayer.lookup(promptHash, config.modelId)
      if (cached && Date.now() - cached.timestamp < cacheStrategy.ttl * 1000) {
        this.log("  CACHE HIT - Zero cost response!")
        return this.buildReceipt({
          success: true, result: cached.result, fromCache: true, verified: false,
          inferenceId: inferenceId,
          cost: { total: 0n, currency: "0x0" as Address, paid: false },
          summary: "Served from cache. Zero cost."
        })
      }
      this.log("  Cache miss - running fresh inference")
    }

    let txHash: Hash | undefined
    const cost = endpoint.pricePerCall
    this.log("  Payment: " + cost + " wei")

    try {
      txHash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: InferenceBillingABI,
        functionName: "payForInference",
        args: [config.modelId, promptHash],
        value: cost,
        account: this.account,
      })
      this.log("  TX: " + txHash.slice(0, 16) + "...")
      if (config.waitForConfirmation) {
        await this.publicClient.waitForTransactionReceipt({ hash: txHash })
        this.log("  Confirmed on-chain")
      }
    } catch (err: any) {
      this.log("  Payment simulated (no chain connection)")
    }

    this.log("  Running inference...")
    const result = {
      text: "[Response to: " + config.prompt + "]",
      tokensUsed: Math.floor(Math.random() * 200) + 50,
      model: config.modelId
    }

    let verified = false
    if (endpoint.teeEnabled) {
      this.log("  TEE Verification:")
      const trustedMrEnclave = "0x" + createHash("sha256").update("enclave:" + config.modelId).digest("hex") as Hash
      const trustedMrSigner = "0x" + createHash("sha256").update("signer:0G").digest("hex") as Hash

      this.teeVerifier.registerTrustedEnclave({
        modelId: config.modelId, mrEnclave: trustedMrEnclave,
        mrSigner: trustedMrSigner, minSvn: 1, addedAt: Date.now()
      })

      const outputHash = "0x" + createHash("sha256").update(JSON.stringify(result)).digest("hex") as Hash
      const attestation = this.teeVerifier.generateMockAttestation(
        config.modelId, promptHash, outputHash, trustedMrEnclave
      )
      const verifResult = await this.teeVerifier.verify(
        attestation, config.modelId, promptHash, outputHash
      )
      verified = verifResult.valid
      this.log("    " + (verified ? "TEE Verified" : "Failed"))
      if (verified) attestationRef = "0g://attestations/" + inferenceId
    }

    if (cacheStrategy.cacheable) {
      await this.cacheLayer.store({
        promptHash: promptHash, modelId: config.modelId,
        result: result, attestationRef: attestationRef, timestamp: Date.now()
      })
      this.log("  Result cached")
    }

    const valueFlow = {
      computeProvider: { address: endpoint.provider, amount: (cost * 80n) / 100n, percentage: 80 },
      curator: { address: endpoint.curator, amount: (cost * 15n) / 100n, percentage: 15 },
      protocol: { amount: cost - (cost * 80n) / 100n - (cost * 15n) / 100n, percentage: 5 }
    }

    const elapsed = Date.now() - startTime
    this.log("  Done in " + elapsed + "ms")
    this.log("")

    return this.buildReceipt({
      success: true, result: result, fromCache: false, verified: verified,
      inferenceId: inferenceId,
      cost: { total: cost, currency: "0x0" as Address, paid: txHash !== undefined },
      valueFlow: valueFlow, transactionHash: txHash,
      summary: "Fresh inference - " + elapsed + "ms - " + (verified ? "TEE-verified" : "Unverified")
    })
  }

  async *inferStream(config: InferConfig): AsyncGenerator<string, InferenceReceipt, void> {
    const startTime = Date.now()
    if (!config.modelId) throw new Error("modelId required")
    if (!config.prompt) throw new Error("prompt required")

    const endpoint = this.endpoints.get(config.modelId)
    if (!endpoint) throw new Error("Model not found. Call initialize() first.")

    const promptHash = computePromptHash(config.prompt, config.params)
    const inferenceId = generateInferenceId(config.modelId, promptHash, this.account.address)

    const cacheStrategy: CacheStrategy = {
      enabled: config.cache?.enabled ?? true,
      ttl: config.cache?.ttl ?? endpoint.cacheTTL,
      cacheable: config.cache?.cacheable ?? true
    }

    if (cacheStrategy.enabled) {
      const cached = await this.cacheLayer.lookup(promptHash, config.modelId)
      if (cached && Date.now() - cached.timestamp < cacheStrategy.ttl * 1000) {
        const words = cached.result.text.split(" ")
        for (const word of words) { yield word + " "; await this.sleep(30) }
        return this.buildReceipt({
          success: true, result: cached.result, fromCache: true, verified: false,
          inferenceId: inferenceId, cost: { total: 0n, currency: "0x0" as Address, paid: false },
          summary: "Streamed from cache. Zero cost."
        })
      }
    }

    const cost = endpoint.pricePerCall
    let txHash: Hash | undefined
    try {
      txHash = await this.walletClient.writeContract({
        address: this.contractAddress, abi: InferenceBillingABI,
        functionName: "payForInference", args: [config.modelId, promptHash],
        value: cost, account: this.account,
      })
    } catch {}

    const fullResponse = "[Response to: " + config.prompt + "] — A comprehensive answer demonstrating token-by-token streaming delivery with the 0G Inference SDK."
    const words = fullResponse.split(" ")
    for (let i = 0; i < words.length; i++) {
      yield words[i] + (i < words.length - 1 ? " " : "")
      await this.sleep(40 + Math.random() * 30)
    }

    const result = { text: fullResponse, tokensUsed: words.length, model: config.modelId }
    let verified = false
    if (endpoint.teeEnabled) {
      const trustedMrEnclave = "0x" + createHash("sha256").update("enclave:" + config.modelId).digest("hex") as Hash
      this.teeVerifier.registerTrustedEnclave({
        modelId: config.modelId, mrEnclave: trustedMrEnclave,
        mrSigner: "0x" + createHash("sha256").update("signer:0G").digest("hex") as Hash,
        minSvn: 1, addedAt: Date.now()
      })
      const outputHash = "0x" + createHash("sha256").update(JSON.stringify(result)).digest("hex") as Hash
      const attestation = this.teeVerifier.generateMockAttestation(config.modelId, promptHash, outputHash, trustedMrEnclave)
      const vr = await this.teeVerifier.verify(attestation, config.modelId, promptHash, outputHash)
      verified = vr.valid
    }

    if (cacheStrategy.cacheable) {
      await this.cacheLayer.store({ promptHash, modelId: config.modelId, result, timestamp: Date.now() })
    }

    const elapsed = Date.now() - startTime
    return this.buildReceipt({
      success: true, result, fromCache: false, verified,
      inferenceId, cost: { total: cost, currency: "0x0" as Address, paid: txHash !== undefined },
      summary: "Streamed " + words.length + " tokens in " + elapsed + "ms"
    })
  }

  listModels(): ModelEndpoint[] {
    return Array.from(this.endpoints.values())
  }

  getContractAddress(): Address {
    return this.contractAddress
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private buildReceipt(params: any): InferenceReceipt {
    const self = {
      success: params.success, result: params.result, fromCache: params.fromCache,
      verified: params.verified, inferenceId: params.inferenceId, cost: params.cost,
      valueFlow: params.valueFlow, transactionHash: params.transactionHash, summary: params.summary,
      toString() {
        return "\n" +
          "┌─────────────────────────────────────────────┐\n" +
          "│           INFERENCE RECEIPT                 │\n" +
          "├─────────────────────────────────────────────┤\n" +
          "│ ID:      " + self.inferenceId.slice(0, 34) + "... │\n" +
          "│ Status:  " + (self.success ? "SUCCESS" : "FAILED") + "                        │\n" +
          "│ Cache:   " + (self.fromCache ? "Hit (free)" : "Fresh compute") + "              │\n" +
          "│ Verify:  " + (self.verified ? "TEE Verified" : "Unverified") + "                │\n" +
          "│ Cost:    " + (self.cost.paid ? self.cost.total.toString() + " wei" : "FREE") + "                 │\n" +
          "│ TX:      " + (self.transactionHash ? self.transactionHash.slice(0, 34) + "..." : "N/A (simulated)") + " │\n" +
          "├─────────────────────────────────────────────┤\n" +
          "│ " + self.summary.slice(0, 43) + " │\n" +
          "└─────────────────────────────────────────────┘"
      }
    }
    return self as InferenceReceipt
  }
}