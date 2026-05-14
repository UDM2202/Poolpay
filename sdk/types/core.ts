import { Hash, Address } from "viem"

export type StorageRef = string

export interface CostBearing {
  exactCost: bigint
  currency: Address
  maxCost: bigint
}

export interface ExecutionProof {
  quote: Hash
  codeMeasurement: Hash
  promptMeasurement: Hash
  outputMeasurement: Hash
  signer: Address
  timestamp: number
}

export interface ValueFlow {
  computeProvider: { address: Address; amount: bigint; percentage: number }
  curator: { address: Address; amount: bigint; percentage: number }
  protocol: { amount: bigint; percentage: number }
}

export interface InferenceReceipt {
  success: boolean
  result: any
  fromCache: boolean
  verified: boolean
  inferenceId: Hash
  proof?: ExecutionProof
  cost: { total: bigint; currency: Address; paid: boolean }
  valueFlow?: ValueFlow
  transactionHash?: Hash
  blockNumber?: bigint
  summary: string
  toString(): string
}

export interface ModelEndpoint {
  id: string
  name: string
  provider: Address
  curator: Address
  pricePerCall: bigint
  teeEnabled: boolean
  cacheTTL: number
  supportedChains: number[]
  metadata: { description: string; capabilities: string[]; maxTokens: number; avatar?: string }
}

export interface CacheStrategy {
  enabled: boolean
  ttl: number
  cacheable: boolean
}