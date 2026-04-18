// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IdentityRegistry — ERC-8004-style Trustless Agent Identity
 * @notice Hackathon-grade single-file deployment for Arc Testnet. Preserves
 *         the canonical ERC-8004 Identity Registry interface (register,
 *         setAgentURI, getMetadata, setMetadata, agentOwner, transferOwnership)
 *         and mints an agent ID as an ERC-721 token whose tokenURI points to
 *         the off-chain agent registration file.
 *
 *         Reputation is tracked in this same contract as a packed mapping —
 *         incrementable only by an admin (the Job contract calls this after
 *         JobCompleted). This collapses ERC-8004's separate Reputation
 *         Registry into the identity contract for simplicity. Validation
 *         Registry is omitted; `validate()` is a no-op stub for interface
 *         compatibility.
 *
 *         Differences vs. spec/canonical (erc-8004/erc-8004-contracts):
 *           - Not UUPS-upgradeable (no proxy infra in this repo)
 *           - Reputation collapsed into identity contract
 *           - No EIP-712 wallet binding (use agent NFT owner directly)
 *           - No URI freeze/locking
 *
 *         All other functions match selectors with the canonical implementation.
 */
contract IdentityRegistry {
    string public constant name = "Darwinia Agent Identity";
    string public constant symbol = "AGENT";

    address public admin;
    uint256 public totalAgents;

    mapping(uint256 => address) private _owners;
    mapping(uint256 => string) private _tokenURIs;
    mapping(uint256 => mapping(bytes32 => bytes)) private _metadata;
    mapping(uint256 => uint256) public reputation;
    mapping(address => uint256) public agentIdOf; // owner address -> agentId (1 per addr)

    event AgentRegistered(uint256 indexed agentId, address indexed owner, string agentURI);
    event AgentURIUpdated(uint256 indexed agentId, string agentURI);
    event AgentOwnershipTransferred(uint256 indexed agentId, address indexed from, address indexed to);
    event MetadataUpdated(uint256 indexed agentId, bytes32 indexed key, bytes value);
    event ReputationIncremented(uint256 indexed agentId, uint256 delta, uint256 newTotal, address by);
    event AdminChanged(address indexed previous, address indexed next);

    error NotAdmin();
    error NotAgentOwner();
    error AgentDoesNotExist();
    error AddressAlreadyHasAgent();
    error ZeroAddress();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyAgentOwner(uint256 agentId) {
        if (_owners[agentId] == address(0)) revert AgentDoesNotExist();
        if (_owners[agentId] != msg.sender) revert NotAgentOwner();
        _;
    }

    constructor(address admin_) {
        if (admin_ == address(0)) revert ZeroAddress();
        admin = admin_;
    }

    // ─────────────────────── Identity ───────────────────────

    function register(string calldata agentURI) external returns (uint256 agentId) {
        if (agentIdOf[msg.sender] != 0) revert AddressAlreadyHasAgent();
        agentId = ++totalAgents;
        _owners[agentId] = msg.sender;
        _tokenURIs[agentId] = agentURI;
        agentIdOf[msg.sender] = agentId;
        emit AgentRegistered(agentId, msg.sender, agentURI);
    }

    /// @notice Admin shortcut: register an agent on behalf of `owner_` (e.g.
    ///         a Circle DCW that cannot easily call from its own context).
    function registerFor(address owner_, string calldata agentURI)
        external onlyAdmin returns (uint256 agentId)
    {
        if (owner_ == address(0)) revert ZeroAddress();
        if (agentIdOf[owner_] != 0) revert AddressAlreadyHasAgent();
        agentId = ++totalAgents;
        _owners[agentId] = owner_;
        _tokenURIs[agentId] = agentURI;
        agentIdOf[owner_] = agentId;
        emit AgentRegistered(agentId, owner_, agentURI);
    }

    function setAgentURI(uint256 agentId, string calldata agentURI)
        external onlyAgentOwner(agentId)
    {
        _tokenURIs[agentId] = agentURI;
        emit AgentURIUpdated(agentId, agentURI);
    }

    function tokenURI(uint256 agentId) external view returns (string memory) {
        if (_owners[agentId] == address(0)) revert AgentDoesNotExist();
        return _tokenURIs[agentId];
    }

    function agentOwner(uint256 agentId) external view returns (address) {
        return _owners[agentId];
    }

    function transferAgentOwnership(uint256 agentId, address to)
        external onlyAgentOwner(agentId)
    {
        if (to == address(0)) revert ZeroAddress();
        if (agentIdOf[to] != 0) revert AddressAlreadyHasAgent();
        address from = msg.sender;
        _owners[agentId] = to;
        delete agentIdOf[from];
        agentIdOf[to] = agentId;
        emit AgentOwnershipTransferred(agentId, from, to);
    }

    // ─────────────────────── Metadata ───────────────────────

    function setMetadata(uint256 agentId, bytes32 key, bytes calldata value)
        external onlyAgentOwner(agentId)
    {
        _metadata[agentId][key] = value;
        emit MetadataUpdated(agentId, key, value);
    }

    function getMetadata(uint256 agentId, bytes32 key) external view returns (bytes memory) {
        return _metadata[agentId][key];
    }

    // ─────────────────────── Reputation ───────────────────────

    /// @notice Called by the Job contract (or admin) after JobCompleted to
    ///         credit reputation. `delta` mirrors Darwinia's iteration count.
    function incrementReputation(uint256 agentId, uint256 delta) external onlyAdmin {
        if (_owners[agentId] == address(0)) revert AgentDoesNotExist();
        reputation[agentId] += delta;
        emit ReputationIncremented(agentId, delta, reputation[agentId], msg.sender);
    }

    function getReputation(uint256 agentId) external view returns (uint256) {
        return reputation[agentId];
    }

    // ─────────────────────── Admin ───────────────────────

    function setAdmin(address next) external onlyAdmin {
        if (next == address(0)) revert ZeroAddress();
        emit AdminChanged(admin, next);
        admin = next;
    }
}
