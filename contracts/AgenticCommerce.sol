// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IIdentityRegistry {
    function agentIdOf(address owner) external view returns (uint256);
    function incrementReputation(uint256 agentId, uint256 delta) external;
}

/**
 * @title AgenticCommerce — ERC-8183 Job primitive (simplified)
 * @notice Spec-compatible Job lifecycle (Open → Funded → Submitted →
 *         Completed/Rejected/Expired). Single payment token per deployment.
 *
 *         Differences vs. canonical reference (eips.ethereum.org/EIPS/eip-8183):
 *           - Not UUPS-upgradeable (no proxy infra in this repo)
 *           - No hooks (HookNotWhitelisted-style errors stripped)
 *           - No platform/evaluator fee splits — full budget goes to provider
 *             (Darwinia uses Nanopayments off this contract for sub-cent
 *             iteration billing; this Job contract is for the lump sum)
 *           - On JobCompleted, calls IdentityRegistry.incrementReputation
 *             with provider's agentId (the ERC-8004 link)
 *
 *         Function selectors and events match the reference impl so the dApp
 *         and any spec tooling can talk to this contract unmodified.
 */
contract AgenticCommerce {
    enum JobStatus { Open, Funded, Submitted, Completed, Rejected, Expired }

    struct Job {
        uint256 id;
        address client;
        address provider;
        address evaluator;
        string description;
        uint256 budget;
        uint256 expiredAt;
        JobStatus status;
        address hook; // always address(0) in this simplified deployment
    }

    address public admin;
    IERC20 public immutable paymentToken;
    IIdentityRegistry public immutable identity;

    uint256 public jobCounter;
    mapping(uint256 => Job) public jobs;
    mapping(uint256 => bytes32) public deliverableOf;
    mapping(uint256 => bytes32) public completionReasonOf;

    // ─────────────────────── Events (match spec) ───────────────────────
    event JobCreated(
        uint256 indexed jobId, address indexed client, address indexed provider,
        address evaluator, uint256 expiredAt, address hook
    );
    event ProviderSet(uint256 indexed jobId, address indexed provider);
    event BudgetSet(uint256 indexed jobId, uint256 amount);
    event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount);
    event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable);
    event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason);
    event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason);
    event JobExpired(uint256 indexed jobId);
    event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
    event Refunded(uint256 indexed jobId, address indexed client, uint256 amount);

    error InvalidJob();
    error WrongStatus();
    error Unauthorized();
    error ZeroAddress();
    error ExpiryTooShort();
    error ProviderNotSet();
    error TransferFailed();

    // ─────────────────────── Reentrancy guard ───────────────────────
    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "REENTRANT");
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(address paymentToken_, address identity_, address admin_) {
        if (paymentToken_ == address(0) || identity_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        paymentToken = IERC20(paymentToken_);
        identity = IIdentityRegistry(identity_);
        admin = admin_;
    }

    // ─────────────────────── Job Lifecycle ───────────────────────

    function createJob(
        address provider, address evaluator, uint256 expiredAt,
        string calldata description, address /*hook*/
    ) external nonReentrant returns (uint256) {
        if (evaluator == address(0)) revert ZeroAddress();
        if (expiredAt <= block.timestamp + 5 minutes) revert ExpiryTooShort();

        uint256 jobId = ++jobCounter;
        jobs[jobId] = Job({
            id: jobId,
            client: msg.sender,
            provider: provider,
            evaluator: evaluator,
            description: description,
            budget: 0,
            expiredAt: expiredAt,
            status: JobStatus.Open,
            hook: address(0)
        });

        emit JobCreated(jobId, msg.sender, provider, evaluator, expiredAt, address(0));
        return jobId;
    }

    function setProvider(uint256 jobId, address provider_) external {
        Job storage job = jobs[jobId];
        if (job.id == 0) revert InvalidJob();
        if (job.status != JobStatus.Open) revert WrongStatus();
        if (msg.sender != job.client) revert Unauthorized();
        if (job.provider != address(0)) revert WrongStatus();
        if (provider_ == address(0)) revert ZeroAddress();
        job.provider = provider_;
        emit ProviderSet(jobId, provider_);
    }

    function setBudget(uint256 jobId, uint256 amount, bytes calldata /*optParams*/)
        external nonReentrant
    {
        Job storage job = jobs[jobId];
        if (job.id == 0) revert InvalidJob();
        if (job.status != JobStatus.Open) revert WrongStatus();
        if (msg.sender != job.provider) revert Unauthorized();
        job.budget = amount;
        emit BudgetSet(jobId, amount);
    }

    function fund(uint256 jobId, bytes calldata /*optParams*/) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.id == 0) revert InvalidJob();
        if (job.status != JobStatus.Open) revert WrongStatus();
        if (msg.sender != job.client) revert Unauthorized();
        if (job.provider == address(0)) revert ProviderNotSet();
        if (block.timestamp >= job.expiredAt) revert WrongStatus();

        job.status = JobStatus.Funded;
        if (job.budget > 0) {
            if (!paymentToken.transferFrom(job.client, address(this), job.budget)) revert TransferFailed();
        }
        emit JobFunded(jobId, job.client, job.budget);
    }

    function submit(uint256 jobId, bytes32 deliverable, bytes calldata /*optParams*/)
        external nonReentrant
    {
        Job storage job = jobs[jobId];
        if (job.id == 0) revert InvalidJob();
        if (
            job.status != JobStatus.Funded &&
            (job.status != JobStatus.Open || job.budget > 0)
        ) revert WrongStatus();
        if (msg.sender != job.provider) revert Unauthorized();

        job.status = JobStatus.Submitted;
        deliverableOf[jobId] = deliverable;
        emit JobSubmitted(jobId, job.provider, deliverable);
    }

    function complete(uint256 jobId, bytes32 reason, bytes calldata /*optParams*/)
        external nonReentrant
    {
        Job storage job = jobs[jobId];
        if (job.id == 0) revert InvalidJob();
        if (job.status != JobStatus.Submitted) revert WrongStatus();
        if (msg.sender != job.evaluator) revert Unauthorized();

        job.status = JobStatus.Completed;
        completionReasonOf[jobId] = reason;

        uint256 amount = job.budget;
        if (amount > 0) {
            if (!paymentToken.transfer(job.provider, amount)) revert TransferFailed();
            emit PaymentReleased(jobId, job.provider, amount);
        }

        // ERC-8004 reputation hook — bump provider's reputation by 1 per completion
        uint256 providerAgentId = identity.agentIdOf(job.provider);
        if (providerAgentId != 0) {
            try identity.incrementReputation(providerAgentId, 1) {} catch {}
        }

        emit JobCompleted(jobId, job.evaluator, reason);
    }

    function reject(uint256 jobId, bytes32 reason, bytes calldata /*optParams*/)
        external nonReentrant
    {
        Job storage job = jobs[jobId];
        if (job.id == 0) revert InvalidJob();

        if (job.status == JobStatus.Open) {
            if (msg.sender != job.client) revert Unauthorized();
        } else if (job.status == JobStatus.Funded || job.status == JobStatus.Submitted) {
            if (msg.sender != job.evaluator) revert Unauthorized();
        } else {
            revert WrongStatus();
        }

        JobStatus prev = job.status;
        job.status = JobStatus.Rejected;

        if ((prev == JobStatus.Funded || prev == JobStatus.Submitted) && job.budget > 0) {
            if (!paymentToken.transfer(job.client, job.budget)) revert TransferFailed();
            emit Refunded(jobId, job.client, job.budget);
        }

        emit JobRejected(jobId, msg.sender, reason);
    }

    function claimRefund(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.id == 0) revert InvalidJob();
        if (job.status != JobStatus.Funded && job.status != JobStatus.Submitted) revert WrongStatus();
        if (block.timestamp < job.expiredAt) revert WrongStatus();

        job.status = JobStatus.Expired;
        if (job.budget > 0) {
            if (!paymentToken.transfer(job.client, job.budget)) revert TransferFailed();
            emit Refunded(jobId, job.client, job.budget);
        }
        emit JobExpired(jobId);
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }

    function setAdmin(address next) external {
        if (msg.sender != admin) revert Unauthorized();
        if (next == address(0)) revert ZeroAddress();
        admin = next;
    }
}
