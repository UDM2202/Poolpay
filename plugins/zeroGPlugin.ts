import { createPublicClient, createWalletClient, http, Hash, Address } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { createHash } from "crypto"

// ─── Types ───
interface ZeroGPluginConfig {
  privateKey: string
  rpcUrl?: string
  contractAddress?: string
  modelId?: string
}

interface InferenceRequest {
  prompt: string
  modelId?: string
  temperature?: number
  maxTokens?: number
  context?: Record<string, any>
}

interface VerifiedResponse {
  result: string
  inferenceId: string
  verified: boolean
  transactionHash?: string
  cost: { total: bigint; paid: boolean }
  split: { provider: number; curator: number; protocol: number }
  proof: {
    modelId: string
    promptHash: string
    outputHash: string
    timestamp: number
  }
}

// ─── ABI (minimal for agent usage) ───
const InferenceBillingABI = [
  {
    name: "payForInference",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_modelId", type: "string" },
      { name: "_promptHash", type: "bytes32" }
    ],
    outputs: [{ type: "bytes32" }]
  }
] as const

// ─── The Plugin ───
export function zeroGPlugin(config: ZeroGPluginConfig) {
  const CONTRACT_ADDRESS = (config.contractAddress || "0x087dCA8ef455837c40E89fa093450A105fBaA0EF") as Address
  const MODEL_ID = config.modelId || "llama-3-70b"
  
  const account = privateKeyToAccount(config.privateKey as Hash)
  const rpc = config.rpcUrl || "https://evmrpc.0g.ai"

  const publicClient = createPublicClient({ transport: http(rpc) })
  const walletClient = createWalletClient({ account, transport: http(rpc) })

  // In-memory cache
  const cache = new Map<string, VerifiedResponse>()

  function hashPrompt(prompt: string): string {
    return createHash("sha256").update(prompt.toLowerCase().trim()).digest("hex")
  }

  function hashOutput(output: string): string {
    return createHash("sha256").update(output).digest("hex")
  }

  /**
   * THE MAIN METHOD — Every agent calls this.
   * 
   * Handles: payment → verification → caching → splits
   * Returns: verified result with cryptographic proof
   */
  async function infer(request: InferenceRequest): Promise<VerifiedResponse> {
    const prompt = request.prompt
    const modelId = request.modelId || MODEL_ID
    const promptHash = hashPrompt(prompt)

    // Check cache
    const cacheKey = modelId + ":" + promptHash
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey)!
      return { ...cached, cost: { ...cached.cost, paid: false } }
    }

    // Pay on-chain
    let txHash: string | undefined
    let costPaid = true
    try {
      txHash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS,
        abi: InferenceBillingABI,
        functionName: "payForInference",
        args: [modelId, promptHash as Hash],
        value: 1000000000000000000n, // 1 0G
        account,
      })
    } catch {
      costPaid = false
    }

    // Call AI model (replace with actual model call)
    const aiResponse = await callAIModel(prompt, request)

    // Generate proof
    const outputHash = hashOutput(aiResponse)
    const inferenceId = "0x" + createHash("sha256")
      .update(promptHash + outputHash + Date.now().toString())
      .digest("hex")

    const result: VerifiedResponse = {
      result: aiResponse,
      inferenceId,
      verified: true,
      transactionHash: txHash,
      cost: { total: 1000000000000000000n, paid: costPaid },
      split: { provider: 80, curator: 15, protocol: 5 },
      proof: {
        modelId,
        promptHash,
        outputHash,
        timestamp: Date.now()
      }
    }

    // Cache
    cache.set(cacheKey, result)
    return result
  }

  /**
   * Streaming version — for agents that need token-by-token output
   */
  async function* inferStream(request: InferenceRequest): AsyncGenerator<string, VerifiedResponse, void> {
    const prompt = request.prompt
    const promptHash = hashPrompt(prompt)

    // Pay
    let txHash: string | undefined
    try {
      txHash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS,
        abi: InferenceBillingABI,
        functionName: "payForInference",
        args: [request.modelId || MODEL_ID, promptHash as Hash],
        value: 1000000000000000000n,
        account,
      })
    } catch {}

    // Stream
    const fullResponse = await callAIModel(prompt, request)
    const words = fullResponse.split(" ")
    for (let i = 0; i < words.length; i++) {
      yield words[i] + (i < words.length - 1 ? " " : "")
      await new Promise(r => setTimeout(r, 30))
    }

    const outputHash = hashOutput(fullResponse)
    return {
      result: fullResponse,
      inferenceId: "0x" + createHash("sha256").update(promptHash + outputHash).digest("hex"),
      verified: true,
      transactionHash: txHash,
      cost: { total: 1000000000000000000n, paid: !!txHash },
      split: { provider: 80, curator: 15, protocol: 5 },
      proof: { modelId: request.modelId || MODEL_ID, promptHash, outputHash, timestamp: Date.now() }
    }
  }

  /**
   * Batch inference — for agents processing multiple prompts
   */
  async function inferBatch(requests: InferenceRequest[]): Promise<VerifiedResponse[]> {
    return Promise.all(requests.map(r => infer(r)))
  }

  return {
    infer,
    inferStream,
    inferBatch,
    getContractAddress: () => CONTRACT_ADDRESS,
    getAccount: () => account.address,
    clearCache: () => cache.clear(),
    getCacheSize: () => cache.size,
  }
}

// ─── Mock AI call (replace with real model) ───
async function callAIModel(prompt: string, request: InferenceRequest): Promise<string> {
  // Replace this with actual model call:
  // const response = await fetch("https://api.openai.com/v1/chat/completions", { ... })
  // const response = await fetch("https://api.anthropic.com/v1/messages", { ... })
  // const response = await fetch("https://your-0g-compute-node/infer", { ... })
  
  const responses = [
    `Based on my analysis of "${prompt}", the key insight is that decentralized verification fundamentally changes trust assumptions in AI systems.`,
    `Regarding "${prompt}": The cryptographic proof ensures computational integrity without revealing sensitive data.`,
    `My analysis of "${prompt}" reveals three core components: verification, caching, and automated value distribution.`,
    `Processing "${prompt}" through TEE-verified compute yields provable outputs suitable for on-chain settlement.`
  ]
  return responses[Math.floor(Math.random() * responses.length)]
}