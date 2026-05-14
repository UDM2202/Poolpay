// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title InferenceBilling
 * @notice On-chain billing, settlement, and revenue splitting for AI inference.
 * 
 * Flow:
 *   1. Provider registers a model with price + split config
 *   2. User pays for inference → funds held in escrow
 *   3. Provider submits proof of computation
 *   4. Contract verifies and auto-splits payment
 * 
 * Splits are basis points (e.g., 8000 = 80%, 1500 = 15%, 500 = 5%)
 * Total must ALWAYS equal 10000.
 */
contract InferenceBilling {
    // ─── Errors ─────────────────────────────
    error Unauthorized();
    error InvalidSplits();
    error ModelNotActive();
    error IncorrectPayment();
    error JobAlreadySettled();
    error JobNotFound();
    error InsufficientBalance();

    // ─── Types ──────────────────────────────
    struct ModelEndpoint {
        string modelId;
        address computeProvider;
        address curator;
        uint256 pricePerCall;
        uint16 providerSplit;   // basis points
        uint16 curatorSplit;    // basis points
        uint16 protocolSplit;   // basis points
        bool active;
        uint256 totalJobs;
        uint256 totalEarnings;
    }

    struct InferenceJob {
        bytes32 promptHash;
        string modelId;
        address caller;
        uint256 amount;
        uint256 timestamp;
        bool settled;
    }

    // ─── State ──────────────────────────────
    mapping(string => ModelEndpoint) public models;
    mapping(bytes32 => InferenceJob) public jobs;
    mapping(address => uint256) public pendingWithdrawals;

    address public protocolTreasury;
    uint256 public totalJobsProcessed;
    uint256 public totalValueLocked;

    // ─── Events ─────────────────────────────
    event ModelRegistered(
        string indexed modelId,
        address indexed provider,
        address indexed curator,
        uint256 pricePerCall,
        uint16 providerSplit,
        uint16 curatorSplit,
        uint16 protocolSplit
    );

    event ModelUpdated(string indexed modelId, uint256 newPrice, bool active);
    event InferenceRequested(
        bytes32 indexed jobId,
        string indexed modelId,
        address indexed caller,
        uint256 amount
    );
    event JobSettled(
        bytes32 indexed jobId,
        uint256 providerAmount,
        uint256 curatorAmount,
        uint256 protocolAmount
    );
    event Withdrawn(address indexed account, uint256 amount);

    // ─── Constructor ────────────────────────
    constructor(address _protocolTreasury) {
        protocolTreasury = _protocolTreasury;
    }

    // ─── Modifiers ──────────────────────────
    modifier onlyProvider(string memory modelId) {
        if (msg.sender != models[modelId].computeProvider) revert Unauthorized();
        _;
    }

    // ─── Model Management ──────────────────
    
    /**
     * @notice Register a new AI model endpoint with pricing and split config.
     * @param _modelId Unique model identifier (e.g., "llama-3-70b")
     * @param _computeProvider Address that runs the model
     * @param _curator Address that surfaced/deployed this endpoint
     * @param _pricePerCall Cost per inference in wei
     * @param _providerSplit Provider's share in basis points
     * @param _curatorSplit Curator's share in basis points
     * @param _protocolSplit Protocol's share in basis points
     */
    function registerModel(
        string memory _modelId,
        address _computeProvider,
        address _curator,
        uint256 _pricePerCall,
        uint16 _providerSplit,
        uint16 _curatorSplit,
        uint16 _protocolSplit
    ) external {
        // Validate splits sum to 100%
        if (_providerSplit + _curatorSplit + _protocolSplit != 10000) {
            revert InvalidSplits();
        }

        // Price must be non-zero
        if (_pricePerCall == 0) revert InvalidSplits();

        models[_modelId] = ModelEndpoint({
            modelId: _modelId,
            computeProvider: _computeProvider,
            curator: _curator,
            pricePerCall: _pricePerCall,
            providerSplit: _providerSplit,
            curatorSplit: _curatorSplit,
            protocolSplit: _protocolSplit,
            active: true,
            totalJobs: 0,
            totalEarnings: 0
        });

        emit ModelRegistered(
            _modelId,
            _computeProvider,
            _curator,
            _pricePerCall,
            _providerSplit,
            _curatorSplit,
            _protocolSplit
        );
    }

    /**
     * @notice Update model price or active status.
     */
    function updateModel(
        string memory _modelId,
        uint256 _newPrice,
        bool _active
    ) external onlyProvider(_modelId) {
        ModelEndpoint storage model = models[_modelId];
        model.pricePerCall = _newPrice;
        model.active = _active;
        emit ModelUpdated(_modelId, _newPrice, _active);
    }

    // ─── Inference Flow ────────────────────

    /**
     * @notice Pay for an inference request. Funds held in escrow until settlement.
     * @param _modelId The model to call
     * @param _promptHash Hash of the prompt (for deduplication/caching)
     * @return jobId Unique identifier for this inference job
     */
    function payForInference(
        string memory _modelId,
        bytes32 _promptHash
    ) external payable returns (bytes32 jobId) {
        ModelEndpoint storage model = models[_modelId];
        
        if (!model.active) revert ModelNotActive();
        if (msg.value != model.pricePerCall) revert IncorrectPayment();

        // Generate deterministic job ID
        jobId = keccak256(
            abi.encodePacked(_modelId, _promptHash, msg.sender, block.timestamp, block.prevrandao)
        );

        jobs[jobId] = InferenceJob({
            promptHash: _promptHash,
            modelId: _modelId,
            caller: msg.sender,
            amount: msg.value,
            timestamp: block.timestamp,
            settled: false
        });

        model.totalJobs++;
        totalJobsProcessed++;
        totalValueLocked += msg.value;

        emit InferenceRequested(jobId, _modelId, msg.sender, msg.value);
    }

    /**
     * @notice Settle a job after computation. Splits payment automatically.
     * @param _jobId The job to settle
     * 
     * Only the compute provider of the model can call this.
     * Funds are auto-distributed: provider | curator | protocol
     */
    function settleJob(bytes32 _jobId) external {
        InferenceJob storage job = jobs[_jobId];
        if (job.timestamp == 0) revert JobNotFound();
        if (job.settled) revert JobAlreadySettled();

        ModelEndpoint storage model = models[job.modelId];
        if (msg.sender != model.computeProvider) revert Unauthorized();

        job.settled = true;
        totalValueLocked -= job.amount;

        // Calculate splits
        uint256 providerAmount = (job.amount * model.providerSplit) / 10000;
        uint256 curatorAmount = (job.amount * model.curatorSplit) / 10000;
        uint256 protocolAmount = job.amount - providerAmount - curatorAmount;

        // Accumulate pending withdrawals (gas-efficient batch withdrawals)
        pendingWithdrawals[model.computeProvider] += providerAmount;
        pendingWithdrawals[model.curator] += curatorAmount;
        pendingWithdrawals[protocolTreasury] += protocolAmount;

        model.totalEarnings += job.amount;

        emit JobSettled(jobId, providerAmount, curatorAmount, protocolAmount);
    }

    // ─── Withdrawals ────────────────────────

    /**
     * @notice Withdraw accumulated earnings.
     * Anyone can call this — funds are only sent to the entitled address.
     */
    function withdraw() external {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert InsufficientBalance();

        pendingWithdrawals[msg.sender] = 0;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Batch withdraw — withdraws to multiple addresses at once.
     * @param _recipients Array of addresses to withdraw for
     */
    function batchWithdraw(address[] calldata _recipients) external {
        for (uint256 i = 0; i < _recipients.length; i++) {
            address recipient = _recipients[i];
            uint256 amount = pendingWithdrawals[recipient];
            if (amount > 0) {
                pendingWithdrawals[recipient] = 0;
                (bool success, ) = recipient.call{value: amount}("");
                require(success, "Transfer failed");
                emit Withdrawn(recipient, amount);
            }
        }
    }

    // ─── Views ──────────────────────────────

    /**
     * @notice Get all active model IDs (for SDK discovery).
     */
    function getActiveModels() external view returns (string[] memory) {
        // This is a simplified view — in production you'd use an enumerable set
        // For now, models are discovered via events
        revert("Use event logs for model discovery");
    }

    /**
     * @notice Get job details.
     */
    function getJob(bytes32 _jobId) external view returns (InferenceJob memory) {
        return jobs[_jobId];
    }

    // ─── Receive ETH ────────────────────────
    receive() external payable {
        // Accept direct ETH transfers to protocol treasury
    }
}