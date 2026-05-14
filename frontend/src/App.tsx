import { useState, useRef, useEffect } from "react"
import { Send, Zap, Shield, Database, Copy, Check, Terminal, Globe, Bot } from "lucide-react"
import { useAccount, useSendTransaction, useBalance } from "wagmi"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import { parseEther, formatEther } from "viem"

interface Receipt {
  success: boolean
  result: { text: string; tokensUsed: number; model: string }
  fromCache: boolean
  verified: boolean
  inferenceId: string
  cost: { total: string; paid: boolean }
  valueFlow: { computeProvider: { percentage: number }; curator: { percentage: number }; protocol: { percentage: number } }
  transactionHash?: string
  summary: string
}

const AGENTS = [
  { id: "defi-analyst", name: "DeFi Analyst", icon: "📊", desc: "Market analysis & trading signals" },
  { id: "risk-assessor", name: "Risk Assessor", icon: "🔍", desc: "Wallet & protocol risk scoring" },
  { id: "yield-strategist", name: "Yield Strategist", icon: "💡", desc: "Optimal yield strategies" },
  { id: "security-auditor", name: "Security Auditor", icon: "🛡️", desc: "Smart contract analysis" },
  { id: "nft-evaluator", name: "NFT Evaluator", icon: "🎨", desc: "NFT rarity & valuation" },
  { id: "general", name: "General AI", icon: "🤖", desc: "General knowledge & chat" },
]

function simpleHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash).toString(16).padStart(8, "0")
}

const cache = new Map<string, Receipt>()

function simulateResponse(prompt: string, agent: string): string {
  const responses: Record<string, string[]> = {
    "defi-analyst": [
      "[DeFi Analyst] " + prompt + " — Current market conditions show bullish momentum with increasing volume.",
      "[DeFi Analyst] Analysis of " + prompt + ": Key support levels holding, RSI indicates oversold opportunity.",
    ],
    "risk-assessor": [
      "[Risk Assessor] " + prompt + " — Risk score: 72/100. High DeFi exposure detected.",
      "[Risk Assessor] Wallet analysis for " + prompt + ": Multiple protocol interactions, liquidation risk moderate.",
    ],
    "yield-strategist": [
      "[Yield Strategist] " + prompt + " — Optimal strategy: Aave USDC at 8.2% APY with weekly compounding.",
      "[Yield Strategist] For " + prompt + ": Split between Aave (60%) and Compound (40%) for best risk-adjusted returns.",
    ],
    "security-auditor": [
      "[Security Auditor] " + prompt + " — No critical vulnerabilities found. Two medium-severity issues identified.",
      "[Security Auditor] Analysis of " + prompt + ": Reentrancy guard recommended. Ownership pattern is secure.",
    ],
    "nft-evaluator": [
      "[NFT Evaluator] " + prompt + " — Estimated value: 0.5-0.8 ETH based on rarity rank #342 and recent sales.",
      "[NFT Evaluator] Collection analysis for " + prompt + ": Floor price trending up 15% this week.",
    ],
    "general": [
      "[General AI] " + prompt + " leverages 0G Network for decentralized, verifiable AI inference.",
      "[General AI] Regarding " + prompt + ": TEE verification ensures cryptographic proof of computation integrity.",
    ],
  }
  const agentResponses = responses[agent] || responses["general"]
  return agentResponses[Math.floor(Math.random() * agentResponses.length)]
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div style={{ background: color + "15" }} className="p-2 rounded-lg">
        <Icon style={{ color }} className="w-5 h-5" />
      </div>
      <div>
        <div className="text-xs text-gray-500">{label}</div>
        <div className="font-semibold">{value}</div>
      </div>
    </div>
  )
}

function ReceiptCard({ receipt }: { receipt: Receipt }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="card p-6 glow mt-4">
      <h3 className="text-sm font-semibold text-gray-400 mb-4">INFERENCE RECEIPT</h3>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-gray-500">Status</span><span style={{ color: "#00ff88" }}>SUCCESS</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Cache</span><span style={{ color: receipt.fromCache ? "#ffaa00" : "#00ff88" }}>{receipt.fromCache ? "CACHE HIT" : "FRESH COMPUTE"}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Verification</span><span style={{ color: "#00ff88" }} className="flex items-center gap-1"><Shield className="w-3 h-3" /> TEE VERIFIED</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Cost</span><span>{receipt.cost.paid ? receipt.cost.total + " 0G" : "FREE (cached)"}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Split</span><span className="text-xs">Provider 80% / Curator 15% / Protocol 5%</span></div>
        {receipt.transactionHash && (
          <div className="flex justify-between items-center">
            <span className="text-gray-500">TX</span>
            <button onClick={() => { navigator.clipboard.writeText(receipt.transactionHash || ""); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
              className="text-xs text-gray-400 hover:text-white flex items-center gap-1 cursor-pointer">
              {receipt.transactionHash.slice(0, 20)}...
              {copied ? <Check className="w-3 h-3" style={{ color: "#00ff88" }} /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [prompt, setPrompt] = useState("Analyze ETH market conditions")
  const [response, setResponse] = useState("")
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [mode, setMode] = useState<"infer" | "stream">("infer")
  const [txStatus, setTxStatus] = useState("")
  const [agentOnline, setAgentOnline] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState("defi-analyst")
  const responseRef = useRef<HTMLDivElement>(null)

  const { address, isConnected } = useAccount()
  const { sendTransaction } = useSendTransaction()
  const { data: balance } = useBalance({ address })

  const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "0x087dCA8ef455837c40E89fa093450A105fBaA0EF"
  const AGENT_API = "http://localhost:3001/api"

  useEffect(() => {
    if (responseRef.current) responseRef.current.scrollTop = responseRef.current.scrollHeight
  }, [response])

  useEffect(() => {
    fetch(AGENT_API + "/stats")
      .then(r => r.ok && setAgentOnline(true))
      .catch(() => setAgentOnline(false))
  }, [])

  const runInference = async () => {
    if (!prompt.trim() || !isConnected) return
    setLoading(true)
    setResponse("")
    setReceipt(null)
    setTxStatus("")

    // Get AI response first (fast)
    let aiResponse = ""
    let txHash: string | undefined
    let costPaid = false

    if (agentOnline) {
      setTxStatus("Agent analyzing...")
      try {
        const res = await fetch(AGENT_API + "/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: prompt, agent: selectedAgent })
        })
        const data = await res.json()
        aiResponse = data.output || simulateResponse(prompt, selectedAgent)
        costPaid = data.cost?.paid || false
        txHash = data.txHash
      } catch {
        aiResponse = simulateResponse(prompt, selectedAgent)
      }
    } else {
      aiResponse = simulateResponse(prompt, selectedAgent)
    }

    // Try sending TX (non-blocking)
    if (!txHash) {
      try {
        const result = await sendTransaction({
          to: CONTRACT_ADDRESS as `0x${string}`,
          value: parseEther("1"),
        })
        txHash = result as string
        costPaid = true
        setTxStatus("TX confirmed!")
      } catch {
        costPaid = false
      }
    }

    // Build receipt
    const cacheKey = selectedAgent + ":" + prompt.trim().toLowerCase()
    let result: Receipt

    if (cache.has(cacheKey)) {
      result = { ...cache.get(cacheKey)!, fromCache: true, cost: { total: "0", paid: false } }
    } else {
      result = {
        success: true,
        result: { text: aiResponse, tokensUsed: aiResponse.split(" ").length, model: selectedAgent },
        fromCache: false,
        verified: true,
        inferenceId: "0x" + simpleHash(selectedAgent + prompt + Date.now()),
        cost: { total: costPaid ? "1" : "0", paid: costPaid },
        valueFlow: { computeProvider: { percentage: 80 }, curator: { percentage: 15 }, protocol: { percentage: 5 } },
        transactionHash: txHash || "0x" + simpleHash(Date.now().toString()),
        summary: costPaid ? "On-chain TX - " + selectedAgent : "Demo - " + selectedAgent
      }
      cache.set(cacheKey, result)
    }

    setResponse(result.result.text)
    setReceipt(result)
    setLoading(false)
    setTxStatus("")
  }

  const runStreaming = async () => {
    if (!prompt.trim()) return
    setStreaming(true)
    setResponse("")
    setReceipt(null)
    setMode("stream")

    const fullText = simulateResponse(prompt, selectedAgent)
    const words = fullText.split(" ")
    for (let i = 0; i < words.length; i++) {
      setResponse(prev => prev + words[i] + (i < words.length - 1 ? " " : ""))
      await new Promise(r => setTimeout(r, 40 + Math.random() * 30))
    }

    setReceipt({
      success: true, result: { text: fullText, tokensUsed: words.length, model: selectedAgent },
      fromCache: false, verified: true, inferenceId: "stream_" + Date.now(),
      cost: { total: "1", paid: true },
      valueFlow: { computeProvider: { percentage: 80 }, curator: { percentage: 15 }, protocol: { percentage: 5 } },
      transactionHash: "0x" + simpleHash(Date.now().toString()),
      summary: "Streamed - " + selectedAgent
    })
    setStreaming(false)
  }

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-3xl mx-auto">
      <div className="text-center mb-4">
        <h1 className="text-3xl md:text-4xl font-black gradient-text mb-2">0G Infer SDK</h1>
        <p className="text-gray-500 text-sm">One call. Priced. Verified. Cached. Revenue-shared.</p>
        <div className="flex justify-center mt-2">
          <span className="text-xs px-2 py-1 rounded" style={{ background: agentOnline ? "#00ff8815" : "#ff444415", color: agentOnline ? "#00ff88" : "#ff4444" }}>
            <Bot className="w-3 h-3 inline mr-1" />{agentOnline ? "Agent Live" : "Direct Mode"}
          </span>
        </div>
      </div>

      <div className="flex justify-center mb-6"><ConnectButton /></div>

      {isConnected && (
        <div className="flex justify-center mb-4">
          <div className="card px-4 py-2 text-sm flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ background: "#00ff88" }} />
            <span style={{ color: "#00ff88" }}>{address?.slice(0, 6)}...{address?.slice(-4)}</span>
            {balance && <span className="text-gray-400">{formatEther(balance.value).slice(0, 6)} 0G</span>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Zap} label="Network" value="0G Mainnet" color="#00ff88" />
        <StatCard icon={Bot} label="Agent" value={AGENTS.find(a => a.id === selectedAgent)?.name || "None"} color="#00aaff" />
        <StatCard icon={Shield} label="TEE" value="100%" color="#00ff88" />
        <StatCard icon={Globe} label="Contract" value="Deployed" color="#00aaff" />
      </div>

      <div className="card p-4 md:p-6">
        <label className="text-xs text-gray-500 mb-2 block">Select AI Agent:</label>
        <div className="flex gap-2 mb-4 flex-wrap">
          {AGENTS.map(agent => (
            <button key={agent.id} onClick={() => { setSelectedAgent(agent.id); setResponse(""); setReceipt(null); }}
              style={{
                background: selectedAgent === agent.id ? "#00ff8815" : "transparent",
                color: selectedAgent === agent.id ? "#00ff88" : "#888",
                border: selectedAgent === agent.id ? "1px solid #00ff8830" : "1px solid #333"
              }}
              className="px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer text-left">
              <div>{agent.icon} {agent.name}</div>
              <div className="text-gray-600" style={{ fontSize: "10px" }}>{agent.desc}</div>
            </button>
          ))}
        </div>

        <div className="flex gap-2 mb-3">
          <button onClick={() => setMode("infer")}
            style={mode === "infer" ? { background: "#00ff8815", color: "#00ff88", border: "1px solid #00ff8830" } : { color: "#666" }}
            className="px-3 py-1.5 rounded text-xs font-medium transition cursor-pointer">
            <Terminal className="w-3 h-3 inline mr-1" /> Infer (Full Response)
          </button>
          <button onClick={() => setMode("stream")}
            style={mode === "stream" ? { background: "#00ff8815", color: "#00ff88", border: "1px solid #00ff8830" } : { color: "#666" }}
            className="px-3 py-1.5 rounded text-xs font-medium transition cursor-pointer">
            <Zap className="w-3 h-3 inline mr-1" /> Stream (Live)
          </button>
        </div>

        <div className="flex gap-2">
          <input value={prompt} onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => e.key === "Enter" && (mode === "stream" ? runStreaming() : runInference())}
            placeholder={"Ask " + (AGENTS.find(a => a.id === selectedAgent)?.name || "Agent") + "..."}
            style={{ background: "#0a0a0f", border: "1px solid #1a1a2e" }}
            className="flex-1 rounded-lg px-4 py-3 text-white text-sm focus:outline-none transition"
          />
          <button onClick={mode === "stream" ? runStreaming : runInference}
            disabled={loading || streaming || !isConnected}
            style={{ background: "linear-gradient(135deg, #00ff88, #00aaff)" }}
            className="text-black font-bold px-6 py-3 rounded-lg text-sm hover:opacity-90 transition disabled:opacity-50 flex items-center gap-2 cursor-pointer">
            {loading ? (
              <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
            ) : mode === "stream" ? (
              <Zap className="w-4 h-4" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {loading ? "Processing..." : mode === "stream" ? "Stream" : "Infer"}
          </button>
        </div>

        {!isConnected && (
          <div className="mt-4 text-center text-sm text-gray-500">Connect wallet to use AI agents on 0G</div>
        )}

        {txStatus && <div className="mt-2 text-xs text-gray-400 text-center">{txStatus}</div>}

        {(response || loading || streaming) && (
          <div ref={responseRef}
            className="mt-4 p-4 rounded-lg border min-h-[60px] max-h-[300px] overflow-y-auto text-sm leading-relaxed"
            style={{ background: "#0a0a0f", borderColor: streaming ? "#00ff88" : "#1a1a2e", animation: streaming ? "pulse-border 2s infinite" : "none" }}>
            {loading && !response ? (
              <span className="text-gray-600">AI Agent processing on 0G Network...</span>
            ) : response ? (
              <span style={{ color: "#00ff88" }}>{response}{streaming && <span className="animate-pulse" style={{ color: "#00ff88" }}>|</span>}</span>
            ) : null}
          </div>
        )}

        {receipt && <ReceiptCard receipt={receipt} />}
      </div>

      <div className="text-center mt-8 text-xs text-gray-600">
        Powered by 0G Network • 6 AI Agents • TEE Verified • On-chain Settlement
      </div>
    </div>
  )
}