export const InferenceBillingABI = [
  // ─── Model Management ───
  {
    name: "registerModel",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_modelId", type: "string" },
      { name: "_computeProvider", type: "address" },
      { name: "_curator", type: "address" },
      { name: "_pricePerCall", type: "uint256" },
      { name: "_providerSplit", type: "uint16" },
      { name: "_curatorSplit", type: "uint16" },
      { name: "_protocolSplit", type: "uint16" }
    ],
    outputs: []
  },
  {
    name: "updateModel",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_modelId", type: "string" },
      { name: "_newPrice", type: "uint256" },
      { name: "_active", type: "bool" }
    ],
    outputs: []
  },
  
  // ─── Inference Flow ───
  {
    name: "payForInference",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_modelId", type: "string" },
      { name: "_promptHash", type: "bytes32" }
    ],
    outputs: [{ name: "jobId", type: "bytes32" }]
  },
  {
    name: "settleJob",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_jobId", type: "bytes32" }
    ],
    outputs: []
  },
  
  // ─── Withdrawals ───
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: []
  },
  {
    name: "batchWithdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_recipients", type: "address[]" }
    ],
    outputs: []
  },
  
  // ─── Views ───
  {
    name: "models",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "modelId", type: "string" }],
    outputs: [
      { name: "modelId", type: "string" },
      { name: "computeProvider", type: "address" },
      { name: "curator", type: "address" },
      { name: "pricePerCall", type: "uint256" },
      { name: "providerSplit", type: "uint16" },
      { name: "curatorSplit", type: "uint16" },
      { name: "protocolSplit", type: "uint16" },
      { name: "active", type: "bool" },
      { name: "totalJobs", type: "uint256" },
      { name: "totalEarnings", type: "uint256" }
    ]
  },
  {
    name: "getJob",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_jobId", type: "bytes32" }],
    outputs: [
      { name: "promptHash", type: "bytes32" },
      { name: "modelId", type: "string" },
      { name: "caller", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "timestamp", type: "uint256" },
      { name: "settled", type: "bool" }
    ]
  },
  {
    name: "pendingWithdrawals",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "amount", type: "uint256" }]
  },
  {
    name: "getActiveModels",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string[]" }]
  },
  
  // ─── Events ───
  {
    name: "ModelRegistered",
    type: "event",
    inputs: [
      { indexed: true, name: "modelId", type: "string" },
      { indexed: true, name: "provider", type: "address" },
      { indexed: true, name: "curator", type: "address" },
      { indexed: false, name: "pricePerCall", type: "uint256" },
      { indexed: false, name: "providerSplit", type: "uint16" },
      { indexed: false, name: "curatorSplit", type: "uint16" },
      { indexed: false, name: "protocolSplit", type: "uint16" }
    ]
  },
  {
    name: "InferenceRequested",
    type: "event",
    inputs: [
      { indexed: true, name: "jobId", type: "bytes32" },
      { indexed: true, name: "modelId", type: "string" },
      { indexed: true, name: "caller", type: "address" },
      { indexed: false, name: "amount", type: "uint256" }
    ]
  },
  {
    name: "JobSettled",
    type: "event",
    inputs: [
      { indexed: true, name: "jobId", type: "bytes32" },
      { indexed: false, name: "providerAmount", type: "uint256" },
      { indexed: false, name: "curatorAmount", type: "uint256" },
      { indexed: false, name: "protocolAmount", type: "uint256" }
    ]
  }
] as const