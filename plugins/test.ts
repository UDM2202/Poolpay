import { zeroGPlugin } from './zeroGPlugin'
import 'dotenv/config'

async function test() {
  console.log('Testing 0G Infer Plugin...\n')

  const plugin = zeroGPlugin({
    privateKey:
      process.env.PRIVATE_KEY ||
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    contractAddress: process.env.CONTRACT_ADDRESS,
  })

  console.log('Connected account:', plugin.getAccount())
  console.log('Contract:', plugin.getContractAddress())

  // Test inference
  console.log('\n1. Testing infer()...')
  const result = await plugin.infer({
    prompt: 'What is the best DeFi strategy right now?',
    temperature: 0.7,
  })

  console.log('   Result:', result.result.slice(0, 80) + '...')
  console.log('   Verified:', result.verified)
  console.log('   TX Hash:', result.transactionHash?.slice(0, 20) + '...')
  console.log('   Cost:', result.cost.total.toString(), 'wei')
  console.log('   Split:', result.split)

  // Test streaming
  console.log('\n2. Testing inferStream()...')
  process.stdout.write('   ')
  for await (const token of plugin.inferStream({ prompt: 'Explain 0G Network' })) {
    process.stdout.write(token)
  }

  // Test batch
  console.log('\n\n3. Testing inferBatch()...')
  const batchResults = await plugin.inferBatch([
    { prompt: 'What is TEE?' },
    { prompt: 'How does 0G work?' },
    { prompt: 'Explain revenue splits' },
  ])
  console.log('   Batch size:', batchResults.length)
  console.log(
    '   All verified:',
    batchResults.every((r) => r.verified)
  )

  console.log('\nCache size:', plugin.getCacheSize())
  console.log('\n✅ Plugin working!\n')
}

test().catch(console.error)
