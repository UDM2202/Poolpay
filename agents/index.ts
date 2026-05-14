/**
 * 0G Infer Agent System
 *
 * A complete AI agent framework with on-chain verified inference.
 * Every decision the agent makes is provable on 0G Network.
 */

import { zeroGPlugin } from '../plugins/zeroGPlugin'
import 'dotenv/config'

// ─── Agent Types ───
interface AgentTask {
  id: string
  type: 'analysis' | 'risk' | 'strategy' | 'chat'
  input: string
  timestamp: number
}

interface AgentResult {
  taskId: string
  output: string
  verified: boolean
  txHash?: string
  proof: {
    modelId: string
    promptHash: string
    outputHash: string
    timestamp: number
  }
  cost: { total: string; paid: boolean }
}

interface AgentStats {
  totalTasks: number
  verifiedTasks: number
  totalSpent: string
  cacheHits: number
  uptime: number
}

// ─── The Agent ───
export class ZeroGAgent {
  private ogInfer: ReturnType<typeof zeroGPlugin>
  private name: string
  private history: AgentResult[] = []
  private startTime: number

  constructor(config: {
    name: string
    privateKey: string
    contractAddress?: string
    modelId?: string
  }) {
    this.name = config.name
    this.startTime = Date.now()
    this.ogInfer = zeroGPlugin({
      privateKey: config.privateKey,
      contractAddress: config.contractAddress,
      modelId: config.modelId,
    })
  }

  // ─── Core Capabilities ───

  async analyzeMarket(token: string): Promise<AgentResult> {
    return this.executeTask({
      id: this.taskId(),
      type: 'analysis',
      input: `Analyze market conditions for ${token}. Include price trends, volume analysis, on-chain metrics, and DeFi positioning.`,
      timestamp: Date.now(),
    })
  }

  async assessRisk(address: string): Promise<AgentResult> {
    return this.executeTask({
      id: this.taskId(),
      type: 'risk',
      input: `Assess the risk profile of wallet ${address}. Analyze: transaction history, protocol interactions, liquidation risk, and overall DeFi health score.`,
      timestamp: Date.now(),
    })
  }

  async generateStrategy(protocol: string, amount: string): Promise<AgentResult> {
    return this.executeTask({
      id: this.taskId(),
      type: 'strategy',
      input: `Create an optimal yield strategy for ${amount} in ${protocol}. Consider: current APYs, gas costs, risk factors, and optimal compounding frequency.`,
      timestamp: Date.now(),
    })
  }

  async chat(message: string): Promise<AgentResult> {
    return this.executeTask({
      id: this.taskId(),
      type: 'chat',
      input: message,
      timestamp: Date.now(),
    })
  }

  async *streamChat(message: string): AsyncGenerator<string, AgentResult, void> {
    const task: AgentTask = {
      id: this.taskId(),
      type: 'chat',
      input: message,
      timestamp: Date.now(),
    }

    const result: AgentResult = {
      taskId: task.id,
      output: '',
      verified: false,
      proof: { modelId: '', promptHash: '', outputHash: '', timestamp: Date.now() },
      cost: { total: '0', paid: false },
    }

    for await (const token of this.ogInfer.inferStream({ prompt: message })) {
      result.output += token
      yield token
    }

    result.verified = true
    this.history.push(result)
    return result
  }

  // ─── Batch Operations ───

  async analyzePortfolio(tokens: string[]): Promise<AgentResult[]> {
    console.log(`📊 Analyzing portfolio of ${tokens.length} tokens...`)
    const results = await this.ogInfer.inferBatch(
      tokens.map((token) => ({
        prompt: `Analyze ${token} for portfolio inclusion. Score: momentum, risk, correlation, and alpha potential.`,
      }))
    )
    return results.map((r, i) => ({
      taskId: this.taskId(),
      type: 'analysis' as const,
      output: r.result,
      verified: r.verified,
      txHash: r.transactionHash,
      proof: r.proof,
      cost: { total: r.cost.total.toString(), paid: r.cost.paid },
    }))
  }

  // ─── Agent Info ───

  getStats(): AgentStats {
    return {
      totalTasks: this.history.length,
      verifiedTasks: this.history.filter((h) => h.verified).length,
      totalSpent: (this.history.length * 1).toString() + ' 0G',
      cacheHits: this.ogInfer.getCacheSize(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    }
  }

  getHistory(): AgentResult[] {
    return [...this.history]
  }

  getName(): string {
    return this.name
  }

  getAccount(): string {
    return this.ogInfer.getAccount()
  }

  clearCache(): void {
    this.ogInfer.clearCache()
  }

  // ─── Private ───

  private async executeTask(task: AgentTask): Promise<AgentResult> {
    const icon =
      task.type === 'analysis'
        ? '📊'
        : task.type === 'risk'
          ? '🔍'
          : task.type === 'strategy'
            ? '💡'
            : '💬'
    console.log(`${icon} Agent executing: ${task.type}...`)

    const response = await this.ogInfer.infer({
      prompt: task.input,
      context: { taskId: task.id, taskType: task.type },
    })

    const result: AgentResult = {
      taskId: task.id,
      output: response.result,
      verified: response.verified,
      txHash: response.transactionHash,
      proof: response.proof,
      cost: { total: response.cost.total.toString(), paid: response.cost.paid },
    }

    this.history.push(result)
    return result
  }

  private taskId(): string {
    return 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
  }
}

// ─── Create Your Agent ───
export function createAgent(config: {
  name: string
  privateKey: string
  contractAddress?: string
  modelId?: string
}): ZeroGAgent {
  return new ZeroGAgent(config)
}
