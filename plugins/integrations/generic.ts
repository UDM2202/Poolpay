/**
 * Generic Agent Integration — Works with ANY agent framework
 *
 * LangChain, CrewAI, AutoGPT, custom agents, etc.
 *
 * Usage:
 *   import { agent0G } from "0g-infer-sdk/plugins/integrations/generic"
 *
 *   const verifiedAI = agent0G({ privateKey: "0x..." })
 *   const result = await verifiedAI.infer({ prompt: "Analyze this" })
 */

import { zeroGPlugin } from '../zeroGPlugin'

export function agent0G(config: {
  privateKey: string
  contractAddress?: string
  modelId?: string
}) {
  const ogInfer = zeroGPlugin(config)

  return {
    // Drop-in replacement for any AI call
    infer: ogInfer.infer,
    inferStream: ogInfer.inferStream,
    inferBatch: ogInfer.inferBatch,

    // LangChain compatible
    asLangChainTool: () => ({
      name: '0g_verified_infer',
      description: 'Run AI inference with on-chain verification and TEE proof',
      func: async (prompt: string) => {
        const result = await ogInfer.infer({ prompt })
        return JSON.stringify(result)
      },
    }),

    // CrewAI compatible
    asCrewAITool: () => ({
      name: '0G Verified Inference',
      description: 'Provable AI inference on 0G Network',
      run: async (prompt: string) => {
        const result = await ogInfer.infer({ prompt })
        return result.result
      },
    }),

    ogInfer,
  }
}
