/**
 * Autonolas Integration for 0G Infer
 *
 * Usage in your Autonolas service:
 *
 * import { autonolas0GModule } from "0g-infer-sdk/plugins/integrations/autonolas"
 *
 * service.registerModule(autonolas0GModule({ privateKey: "0x..." }))
 */

import { zeroGPlugin } from '../zeroGPlugin'

export function autonolas0GModule(config: { privateKey: string; contractAddress?: string }) {
  const ogInfer = zeroGPlugin(config)

  return {
    name: '0g-infer-module',

    // Autonolas service methods
    methods: {
      verified_infer: async (args: { prompt: string }) => {
        const result = await ogInfer.infer({ prompt: args.prompt })
        return JSON.stringify(result)
      },

      verified_infer_stream: async function* (args: { prompt: string }) {
        for await (const token of ogInfer.inferStream({ prompt: args.prompt })) {
          yield token
        }
      },
    },

    ogInfer,
  }
}
