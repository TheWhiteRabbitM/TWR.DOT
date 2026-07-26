// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Personhood precompile exposed by the Polkadot Products runtime.
interface IPersonhood {
    struct PersonhoodInfo {
        uint8 status; // 0 = None, 1 = Lite, 2 = Full
        bytes32 contextAlias;
    }

    function personhoodStatus(address account, bytes32 context)
        external
        view
        returns (PersonhoodInfo memory);
}

/// @title Handshake
/// @notice Plain-language agreements sealed by two real, distinct people —
///         permanent, undeniable, and building a kept-word record that follows
///         the human, not the account.
/// @dev Lifecycle:
///
///        Proposed --accept()--> Accepted --seal()--> Sealed --both markDone()--> Completed
///            \                      \
///             withdraw()             withdraw()          (proposer only, pre-seal)
///
///      Both parties are identified by their personhood `contextAlias`: two
///      wallets of the same human resolve to the same alias, so an agreement
///      cannot be "signed by two people" who are actually one. After sealing,
///      nothing can be edited or removed by anyone.
///
///      Terms are stored in clear on a public test network — the UI warns
///      against personal details. Production would encrypt terms to the two
///      parties.
/// @custom:cdm @thebutton/handshake
contract Handshake {
    enum State {
        Proposed,
        Accepted,
        Sealed,
        Completed,
        Withdrawn
    }

    struct Agreement {
        bytes32 proposer;
        bytes32 acceptor; // zero until accepted
        uint8 proposerTier;
        uint8 acceptorTier;
        uint64 createdAt;
        uint64 sealedAt;
        uint64 completedAt;
        State state;
        bool proposerDone;
        bool acceptorDone;
        string terms;
    }

    /// @notice Kept-word record of one person (by alias).
    struct Record {
        uint32 sealedCount;
        uint32 completedCount;
    }

    address public constant PERSONHOOD = address(uint160(0x0a010000));
    bytes32 public constant CONTEXT = keccak256("handshake.dot");
    uint8 public constant MIN_STATUS = 1;
    /// @dev Open (pre-seal) proposals one alias may have at once. Spam brake.
    uint8 public constant MAX_OPEN_PROPOSALS = 10;
    uint256 public constant MIN_TERMS_BYTES = 8;
    uint256 public constant MAX_TERMS_BYTES = 500;

    Agreement[] private _agreements;
    mapping(bytes32 => Record) private _records;
    mapping(bytes32 => uint8) private _openProposals;

    event Proposed(uint256 indexed id, bytes32 indexed proposer);
    event Accepted(uint256 indexed id, bytes32 indexed acceptor);
    event SealedAgreement(uint256 indexed id, bytes32 indexed proposer, bytes32 indexed acceptor);
    event MarkedDone(uint256 indexed id, bytes32 indexed who);
    event Completed(uint256 indexed id);
    event Withdrawn(uint256 indexed id);

    error NotHuman(uint8 status, uint8 required);
    error UnknownAgreement(uint256 id);
    error WrongState(State current);
    error NotProposer();
    error NotParty();
    error OwnProposal();
    error AlreadyMarked();
    error TooManyOpen(uint8 max);
    error BadTerms(uint256 bytesLength);

    function _identify() private view returns (IPersonhood.PersonhoodInfo memory info) {
        info = IPersonhood(PERSONHOOD).personhoodStatus(msg.sender, CONTEXT);
        if (info.status < MIN_STATUS) {
            revert NotHuman(info.status, MIN_STATUS);
        }
    }

    /// @notice Propose an agreement. Share its link privately with the other
    ///         person; whoever accepts is shown to you before you seal.
    function propose(string calldata terms) external returns (uint256 id) {
        IPersonhood.PersonhoodInfo memory info = _identify();

        uint256 len = bytes(terms).length;
        if (len < MIN_TERMS_BYTES || len > MAX_TERMS_BYTES) revert BadTerms(len);
        if (_openProposals[info.contextAlias] >= MAX_OPEN_PROPOSALS) {
            revert TooManyOpen(MAX_OPEN_PROPOSALS);
        }

        _openProposals[info.contextAlias] += 1;
        id = _agreements.length;
        Agreement storage a = _agreements.push();
        a.proposer = info.contextAlias;
        a.proposerTier = info.status;
        a.createdAt = uint64(block.timestamp);
        a.state = State.Proposed;
        a.terms = terms;

        emit Proposed(id, info.contextAlias);
    }

    /// @notice Accept a proposal as the other party. The proposer still has to
    ///         seal after seeing who accepted — acceptance alone binds nobody.
    function accept(uint256 id) external {
        Agreement storage a = _get(id);
        if (a.state != State.Proposed) revert WrongState(a.state);

        IPersonhood.PersonhoodInfo memory info = _identify();
        if (info.contextAlias == a.proposer) revert OwnProposal();

        a.acceptor = info.contextAlias;
        a.acceptorTier = info.status;
        a.state = State.Accepted;

        emit Accepted(id, info.contextAlias);
    }

    /// @notice Seal the agreement. Proposer only, after seeing the acceptor.
    ///         From here on it is permanent and binding on the record.
    function seal(uint256 id) external {
        Agreement storage a = _get(id);
        if (a.state != State.Accepted) revert WrongState(a.state);

        IPersonhood.PersonhoodInfo memory info = _identify();
        if (info.contextAlias != a.proposer) revert NotProposer();

        a.state = State.Sealed;
        a.sealedAt = uint64(block.timestamp);
        _openProposals[a.proposer] -= 1;
        _records[a.proposer].sealedCount += 1;
        _records[a.acceptor].sealedCount += 1;

        emit SealedAgreement(id, a.proposer, a.acceptor);
    }

    /// @notice Withdraw a proposal before it is sealed. Proposer only. If
    ///         someone had accepted, the agreement returns nothing to either
    ///         record — unsealed proposals never count.
    function withdraw(uint256 id) external {
        Agreement storage a = _get(id);
        if (a.state != State.Proposed && a.state != State.Accepted) revert WrongState(a.state);

        IPersonhood.PersonhoodInfo memory info = _identify();
        if (info.contextAlias != a.proposer) revert NotProposer();

        a.state = State.Withdrawn;
        _openProposals[a.proposer] -= 1;

        emit Withdrawn(id);
    }

    /// @notice Mark your side as done. When both parties have marked done, the
    ///         agreement is Completed and both kept-word records grow.
    function markDone(uint256 id) external {
        Agreement storage a = _get(id);
        if (a.state != State.Sealed) revert WrongState(a.state);

        IPersonhood.PersonhoodInfo memory info = _identify();

        if (info.contextAlias == a.proposer) {
            if (a.proposerDone) revert AlreadyMarked();
            a.proposerDone = true;
        } else if (info.contextAlias == a.acceptor) {
            if (a.acceptorDone) revert AlreadyMarked();
            a.acceptorDone = true;
        } else {
            revert NotParty();
        }

        emit MarkedDone(id, info.contextAlias);

        if (a.proposerDone && a.acceptorDone) {
            a.state = State.Completed;
            a.completedAt = uint64(block.timestamp);
            _records[a.proposer].completedCount += 1;
            _records[a.acceptor].completedCount += 1;
            emit Completed(id);
        }
    }

    /* ------------------------------------------------------------- reads */

    function _get(uint256 id) private view returns (Agreement storage) {
        if (id >= _agreements.length) revert UnknownAgreement(id);
        return _agreements[id];
    }

    function count() external view returns (uint256) {
        return _agreements.length;
    }

    function get(uint256 id) external view returns (Agreement memory) {
        return _get(id);
    }

    /// @notice One person's kept-word record.
    function recordOf(bytes32 contextAlias) external view returns (Record memory) {
        return _records[contextAlias];
    }

    /// @notice The caller's standing, plus role in one agreement.
    /// @return status Personhood tier.
    /// @return yourAlias Alias in this context.
    /// @return role 0 none, 1 proposer, 2 acceptor.
    /// @return yourRecord The caller's kept-word record.
    function me(address account, uint256 id)
        external
        view
        returns (uint8 status, bytes32 yourAlias, uint8 role, Record memory yourRecord)
    {
        IPersonhood.PersonhoodInfo memory info =
            IPersonhood(PERSONHOOD).personhoodStatus(account, CONTEXT);
        status = info.status;
        yourAlias = info.contextAlias;
        yourRecord = _records[info.contextAlias];
        if (id < _agreements.length) {
            Agreement storage a = _agreements[id];
            if (a.proposer == info.contextAlias) role = 1;
            else if (a.acceptor == info.contextAlias) role = 2;
        }
    }

    /// @notice Agreements where the alias is a party, newest-first, paged.
    /// @dev O(n) scan — fine at devnet scale; an indexer replaces this later.
    function mine(bytes32 contextAlias, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids)
    {
        uint256 len = _agreements.length;
        uint256[] memory found = new uint256[](limit);
        uint256 seen = 0;
        uint256 kept = 0;
        for (uint256 i = len; i > 0 && kept < limit; --i) {
            Agreement storage a = _agreements[i - 1];
            if (a.proposer == contextAlias || a.acceptor == contextAlias) {
                if (seen >= offset) {
                    found[kept] = i - 1;
                    kept += 1;
                }
                seen += 1;
            }
        }
        ids = new uint256[](kept);
        for (uint256 i = 0; i < kept; ++i) ids[i] = found[i];
    }
}
