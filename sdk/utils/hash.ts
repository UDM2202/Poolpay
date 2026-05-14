import { createHash } from "crypto"
import { Hash, Address } from "viem"

export function computePromptHash(prompt: string, params?: Record<string, any>): Hash {
  // Normalize: if params is empty/undefined, treat as empty object
  const normalizedParams = params && Object.keys(params).length > 0 ? params : {}
  
  const normalized = JSON.stringify({
    prompt: prompt.trim().toLowerCase(),
    params: normalizedParams
  })
  
  return "0x" + createHash("sha256").update(normalized).digest("hex") as Hash
}

export function generateInferenceId(modelId: string, promptHash: Hash, caller: Address): Hash {
  const combined = modelId + ":" + promptHash + ":" + caller + ":" + Date.now()
  return "0x" + createHash("sha256").update(combined).digest("hex") as Hash
}