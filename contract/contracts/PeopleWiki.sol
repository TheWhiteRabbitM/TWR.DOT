// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMasks {
    function ownerOf(uint256 id) external view returns (address);
}

/// @title PeopleWiki - what this devnet actually does, written down by the people using it
/// @notice A shared notebook for the Polkadot products devnet. Everything here
///         was learned the hard way: an SDK option that is silently ignored, a
///         build that fails without naming a file, a permission whose absence
///         makes a signature hang forever rather than fail. None of it is in any
///         documentation, and each one costs the next person the same hours.
///
///         Anyone holding a mask can add a note; the author can edit or retract
///         their own. Readers vote a note up when it saved them, which is the
///         only ranking signal - there is no editor and no owner.
///
///         Authorship is a mask, which is account-bound and non-transferable, so
///         a note cannot be posted in someone else's name. Combined with a proxy
///         the mask belongs to a real account, so a reader can check who wrote
///         what without trusting this contract.
/// @custom:cdm @thebutton/peoplewiki
contract PeopleWiki {
    error NotYourMask();
    error NoEntry(uint256 id);
    error NotAuthor();
    error BadLength();
    error AlreadyVoted();
    error Gone();

    event Added(uint256 indexed id, uint256 indexed mask, address indexed author, string tag, string title);
    event Edited(uint256 indexed id, uint40 at);
    event Retracted(uint256 indexed id);
    event Voted(uint256 indexed id, address indexed by, uint256 votes);

    IMasks public constant MASKS = IMasks(0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a);

    struct Entry {
        uint256 mask;
        address author;
        uint40 time;
        uint40 edited;
        bool retracted;
        string tag;    // one word, so notes can be grouped without a taxonomy
        string title;
        string body;
    }

    uint256 public count;
    mapping(uint256 => Entry) internal _entries;
    mapping(uint256 => uint256) public votes;
    mapping(uint256 => mapping(address => bool)) public voted;

    /// @param mask  a mask you hold; it is the byline
    /// @param tag   one word, up to 24 bytes, e.g. "signing" or "deploy"
    /// @param title up to 120 bytes
    /// @param body  up to 4000 bytes - room for the exact error and the fix
    function add(uint256 mask, string calldata tag, string calldata title, string calldata body)
        external
        returns (uint256 id)
    {
        if (MASKS.ownerOf(mask) != msg.sender) revert NotYourMask();
        _check(tag, title, body);
        id = ++count;
        _entries[id] = Entry(mask, msg.sender, uint40(block.timestamp), 0, false, tag, title, body);
        emit Added(id, mask, msg.sender, tag, title);
    }

    /// @notice Correct your own note. A wiki entry that cannot be fixed rots.
    function edit(uint256 id, string calldata tag, string calldata title, string calldata body) external {
        Entry storage e = _live(id);
        if (e.author != msg.sender) revert NotAuthor();
        _check(tag, title, body);
        e.tag = tag;
        e.title = title;
        e.body = body;
        e.edited = uint40(block.timestamp);
        emit Edited(id, e.edited);
    }

    /// @notice Withdraw your own note - when something turns out to be wrong,
    ///         leaving it up is worse than never having written it.
    function retract(uint256 id) external {
        Entry storage e = _live(id);
        if (e.author != msg.sender) revert NotAuthor();
        e.retracted = true;
        emit Retracted(id);
    }

    /// @notice Say a note helped. One per account, and it cannot be taken back:
    ///         a vote is a record that it was useful to someone, not a mood.
    function vote(uint256 id) external {
        _live(id);
        if (voted[id][msg.sender]) revert AlreadyVoted();
        voted[id][msg.sender] = true;
        uint256 v = ++votes[id];
        emit Voted(id, msg.sender, v);
    }

    // ----------------------------------------------------------------- reads
    /// @dev Value types and the short strings only. The body is fetched apart,
    ///      because a getter returning several long strings is rejected at
    ///      instantiation on PolkaVM.
    function meta(uint256 id)
        external
        view
        returns (uint256 mask, address author, uint40 time, uint40 edited, bool retracted, uint256 up)
    {
        if (id == 0 || id > count) revert NoEntry(id);
        Entry storage e = _entries[id];
        return (e.mask, e.author, e.time, e.edited, e.retracted, votes[id]);
    }

    function head(uint256 id) external view returns (string memory tag, string memory title) {
        if (id == 0 || id > count) revert NoEntry(id);
        return (_entries[id].tag, _entries[id].title);
    }

    function body(uint256 id) external view returns (string memory) {
        if (id == 0 || id > count) revert NoEntry(id);
        return _entries[id].body;
    }

    function _check(string calldata tag, string calldata title, string calldata b) private pure {
        uint256 t = bytes(tag).length;
        uint256 h = bytes(title).length;
        uint256 n = bytes(b).length;
        if (t == 0 || t > 24 || h == 0 || h > 120 || n == 0 || n > 4000) revert BadLength();
    }

    function _live(uint256 id) private view returns (Entry storage e) {
        if (id == 0 || id > count) revert NoEntry(id);
        e = _entries[id];
        if (e.retracted) revert Gone();
    }
}
