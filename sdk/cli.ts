#!/usr/bin/env node

import { ZeroGInfer } from "./core/client"
import { readFileSync, existsSync } from "fs"
import { join } from "path"

const BANNER = `
   ____   _____   ___ _   _ ____  _____ ____  
  / __ \\ / ___ \\ |_ _| \\ | |  _ \\|  ___|  _ \\ 
 | |  | | |  | |  | ||  \\| | | | | |_  | |_) |
 | |  | | |  | |  | || |\\  | |_| |  _| |  _ < 
 | |__| | |__| | | || | \\ | | | | |   | |_) |
  \\____/ \\____/ |___|_| \\_|_| |_|_|   |____/ 
                                               
  One call. Priced. Verified. Cached. Revenue-shared.
`

const HELP = `
USAGE:
  0g-infer [OPTIONS] "your prompt"

OPTIONS:
  --model, -m     Model ID (default: llama-3-70b)
  --key, -k       Private key (or set 0G_PRIVATE_KEY env var)
  --rpc, -r       RPC URL (default: https://rpc.0g.ai)
  --temp          Temperature 0.0-2.0 (default: 0.7)
  --max-tokens    Max tokens (default: 500)
  --stream, -s    Stream tokens in real-time
  --cache-off     Disable cache
  --list-models   List all available models
  --stats         Show storage statistics
  --help, -h      Show this help

EXAMPLES:
  0g-infer "Explain blockchain"
  0g-infer --stream "Write a poem about DeFi"
  0g-infer --model llama-3-70b --temp 0.9 "What is ZK proof?"
  0g-infer --list-models
  0g-infer --stats

ENV:
  0G_PRIVATE_KEY    Your wallet private key
  0G_RPC_URL        Custom RPC endpoint
`

interface CLIOptions {
  model: string
  key?: string
  rpc?: string
  temp: number
  maxTokens: number
  stream: boolean
  cacheOff: boolean
  listModels: boolean
  stats: boolean
  help: boolean
  prompt: string
}

function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {
    model: "llama-3-70b",
    temp: 0.7,
    maxTokens: 500,
    stream: false,
    cacheOff: false,
    listModels: false,
    stats: false,
    help: false,
    prompt: ""
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    
    switch (arg) {
      case "--model":
      case "-m":
        options.model = args[++i]
        break
      case "--key":
      case "-k":
        options.key = args[++i]
        break
      case "--rpc":
      case "-r":
        options.rpc = args[++i]
        break
      case "--temp":
        options.temp = parseFloat(args[++i])
        break
      case "--max-tokens":
        options.maxTokens = parseInt(args[++i])
        break
      case "--stream":
      case "-s":
        options.stream = true
        break
      case "--cache-off":
        options.cacheOff = true
        break
      case "--list-models":
        options.listModels = true
        break
      case "--stats":
        options.stats = true
        break
      case "--help":
      case "-h":
        options.help = true
        break
      default:
        if (!arg.startsWith("--") && !arg.startsWith("-")) {
          options.prompt = arg
        }
    }
  }

  return options
}

function getPrivateKey(options: CLIOptions): string {
  if (options.key) return options.key
  
  const envKey = process.env["0G_PRIVATE_KEY"]
  if (envKey) return envKey
  
  const configPath = join(process.env["HOME"] || process.env["USERPROFILE"] || ".", ".0g-infer.json")
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"))
      if (config.privateKey) return config.privateKey
    } catch {}
  }
  
  console.log("  \u26a0 No private key set \u2014 using mock (testing mode)")
  console.log("  Set 0G_PRIVATE_KEY env variable for real payments\n")
  return "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
}

async function main() {
  const args = process.argv.slice(2)
  const options = parseArgs(args)

  console.log(BANNER)

  if (options.help) {
    console.log(HELP)
    process.exit(0)
  }

  const privateKey = getPrivateKey(options)
  
  const infer = new ZeroGInfer({
    privateKey: privateKey,
    rpcUrl: options.rpc || process.env["0G_RPC_URL"],
    quiet: true
  })

  await infer.initialize()

  if (options.listModels) {
    console.log("\nAVAILABLE MODELS:")
    console.log("\u2500".repeat(50))
    infer.listModels().forEach(function(m) {
      console.log("  " + m.name)
      console.log("    ID:        " + m.id)
      console.log("    Price:     " + m.pricePerCall + " wei")
      console.log("    TEE:       " + (m.teeEnabled ? "Enabled" : "Disabled"))
      console.log("    Cache TTL: " + m.cacheTTL + "s")
      console.log("    Max Tokens: " + m.metadata.maxTokens)
      console.log("")
    })
    process.exit(0)
  }

  if (options.stats) {
    const stats = infer.getStorageStats()
    console.log("\nSTORAGE STATISTICS:")
    console.log("\u2500".repeat(50))
    console.log("  Memory cache entries: " + stats.memoryEntries)
    console.log("  Storage nodes:        " + stats.storageStats.activeNodes)
    console.log("  Storage connected:    " + stats.storageConnected)
    console.log("")
    process.exit(0)
  }

  if (!options.prompt) {
    console.error("\n\u274c Error: No prompt provided.")
    console.log("Usage: 0g-infer \"your prompt here\"")
    console.log("Try:   0g-infer --help\n")
    process.exit(1)
  }

  console.log("\u2500".repeat(60))

  if (options.stream) {
    console.log("  Streaming response:\n")
    process.stdout.write("  \u{1f916} ")
    
    const stream = infer.inferStream({
      modelId: options.model,
      prompt: options.prompt,
      params: {
        temperature: options.temp,
        maxTokens: options.maxTokens
      },
      cache: options.cacheOff ? { enabled: false, ttl: 0, cacheable: false } : undefined
    })

    for await (const token of stream) {
      process.stdout.write(token)
    }
    
    console.log("\n")
  } else {
    const spinner = ["\u280b", "\u2819", "\u2839", "\u2838", "\u283c", "\u2834", "\u2826", "\u2827", "\u2807", "\u280f"]
    let spinIdx = 0
    const spinnerInterval = setInterval(function() {
      process.stdout.write("\r  " + spinner[spinIdx] + " Inferring...")
      spinIdx = (spinIdx + 1) % spinner.length
    }, 80)
    
    const receipt = await infer.infer({
      modelId: options.model,
      prompt: options.prompt,
      params: {
        temperature: options.temp,
        maxTokens: options.maxTokens
      },
      cache: options.cacheOff ? { enabled: false, ttl: 0, cacheable: false } : undefined
    })

    clearInterval(spinnerInterval)
    process.stdout.write("\r" + " ".repeat(20) + "\r")
    
    console.log("\n" + "\u2500".repeat(60))
    console.log("  RESULT:")
    console.log("\u2500".repeat(60))
    console.log("  " + receipt.result.text)
    
    console.log(receipt.toString())
  }
}

main().catch(function(err) {
  console.error("\n\u274c Error: " + err.message + "\n")
  process.exit(1)
})