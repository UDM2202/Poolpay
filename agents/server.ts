/**
 * 0G Agent Server — REST API for the frontend
 *
 * Your frontend calls this server, which uses the agent with 0G Infer.
 */

import express from 'express'
import cors from 'cors'
import { createAgent } from './index'
import 'dotenv/config'

const app = express()
app.use(cors())
app.use(express.json())

// Create the agent
const agent = createAgent({
  name: '0G DeFi Analyst',
  privateKey: process.env.PRIVATE_KEY || '',
  contractAddress: process.env.CONTRACT_ADDRESS,
})

// ─── API Routes ───

// Analyze a token
app.post('/api/analyze', async (req, res) => {
  const { token } = req.body
  const result = await agent.analyzeMarket(token)
  res.json(result)
})

// Assess wallet risk
app.post('/api/risk', async (req, res) => {
  const { address } = req.body
  const result = await agent.assessRisk(address)
  res.json(result)
})

// Generate strategy
app.post('/api/strategy', async (req, res) => {
  const { protocol, amount } = req.body
  const result = await agent.generateStrategy(protocol, amount)
  res.json(result)
})

// Chat with agent
app.post('/api/chat', async (req, res) => {
  const { message } = req.body
  const result = await agent.chat(message)
  res.json(result)
})

// Stream chat
app.post('/api/chat/stream', async (req, res) => {
  const { message } = req.body

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const stream = agent.streamChat(message)
  for await (const token of stream) {
    res.write(`data: ${JSON.stringify({ token })}\n\n`)
  }
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
  res.end()
})

// Portfolio analysis
app.post('/api/portfolio', async (req, res) => {
  const { tokens } = req.body
  const results = await agent.analyzePortfolio(tokens)
  res.json(results)
})

// Agent stats
app.get('/api/stats', (req, res) => {
  res.json(agent.getStats())
})

// Agent history
app.get('/api/history', (req, res) => {
  res.json(agent.getHistory())
})

// Start server
const PORT = 3001
app.listen(PORT, () => {
  console.log('╔══════════════════════════════════════╗')
  console.log('║   0G AGENT SERVER — LIVE            ║')
  console.log('╚══════════════════════════════════════╝')
  console.log(`\nAgent: ${agent.getName()}`)
  console.log(`Account: ${agent.getAccount().slice(0, 10)}...`)
  console.log(`Server: http://localhost:${PORT}`)
  console.log(`\nEndpoints:`)
  console.log(`  POST /api/analyze   — Market analysis`)
  console.log(`  POST /api/risk      — Wallet risk assessment`)
  console.log(`  POST /api/strategy  — Yield strategy`)
  console.log(`  POST /api/chat      — Chat with agent`)
  console.log(`  GET  /api/stats     — Agent stats`)
  console.log(`  GET  /api/history   — Agent history`)
  console.log(`\n`)
})
