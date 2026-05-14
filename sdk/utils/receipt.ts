export class ReceiptBuilder {
  build(params: any) {
    const self = {
      success: params.success,
      result: params.result,
      fromCache: params.fromCache,
      verified: params.verified,
      inferenceId: params.inferenceId,
      cost: params.cost,
      valueFlow: params.valueFlow,
      transactionHash: params.transactionHash,
      blockNumber: params.blockNumber,
      summary: params.summary,
      toString() {
        return "Receipt: " + self.summary
      }
    }
    return self
  }
}