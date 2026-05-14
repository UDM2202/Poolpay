/**
 * ElizaOS Integration for 0G Infer
 *
 * Usage in your Eliza character:
 *
 * import { eliza0GPlugin } from "0g-infer-sdk/plugins/integrations/eliza"
 *
 * const agent = new Eliza({
 *   character: "...",
 *   plugins: [eliza0GPlugin({ privateKey: process.env.PRIVATE_KEY })]
 * })
 *
 * // Now every AI response is TEE-verified + on-chain
 */

import { zeroGPlugin } from '../zeroGPlugin'

export function eliza0GPlugin(config: { privateKey: string; contractAddress?: string }) {
  const ogInfer = zeroGPlugin(config)

  return {
    name: '0g-infer',
    version: '1.0.0',

    // Hooks into Eliza's action system
    actions: [
      {
        name: 'VERIFIED_INFER',
        description: 'Run verified AI inference on 0G Network',
        handler: async (prompt: string) => {
          const result = await ogInfer.infer({ prompt })
          return {
            text: result.result,
            verified: true,
            txHash: result.transactionHash,
            proof: result.proof,
          }
        },
      },
    ],

    // Provider for verified inference
    providers: {
      verifiedInfer: async (prompt: string) => {
        return ogInfer.infer({ prompt })
      },
    },

    // Direct access
    ogInfer,
  }
}
