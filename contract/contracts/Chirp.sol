// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The peoplebook mask NFT: account-bound and non-transferable. Only its
///         owner check is used here, and that is what makes a chirp unforgeable —
///         a mask cannot be squatted or bought, so posting as one means being the
///         account it belongs to. It returns an address, so Chirp never has to
///         receive a dynamic string back from a cross-contract call.
interface IPeoplebook {
    function ownerOf(uint256 id) external view returns (address);
}

/// @title Chirp — an on-chain microblog worn by peoplebook masks
/// @notice A Twitter/X-style feed that lives entirely in contract storage: no
///         Bulletin, no off-chain host, nothing to expire. You post as a mask
///         you own (peoplebook.ownerOf(mask) == you), so every chirp carries a
///         real, verified identity — the mask, and through it the handle + avatar
///         the reader looks up in peoplebook. Text only, <= 280 bytes.
///
///         EDITABLE: the body is just a storage string, so the author can rewrite
///         their own chirp any time (edit()), with an `edited` timestamp kept so
///         readers see it changed. Chirps are 1-based (`count`); a replyTo of 0
///         means top-level. Likes and follows are plain mappings.
/// @custom:cdm @thebutton/chirp
contract Chirp {
    // --------------------------------------------------------------- errors
    error BadLength();
    error NotYourMask();
    error NoChirp(uint256 id);
    error NotAuthor();
    error AlreadyLiked();
    error NotLiked();

    // --------------------------------------------------------------- events
    event Chirped(uint256 indexed id, uint256 indexed mask, address indexed author, uint256 replyTo, string body);
    event Edited(uint256 indexed id, string body, uint40 at);
    event Liked(uint256 indexed id, address indexed by, bool on, uint256 count);
    event Followed(address indexed follower, uint256 indexed mask, bool on, uint256 count);

    IPeoplebook public constant PEOPLEBOOK =
        IPeoplebook(0x03A484cCd0F1832084Deefca4bF6438d79fE8db6);

    struct Chip {
        uint256 mask;      // the peoplebook token this was posted as
        address author;    // owner of that token at post time
        uint40 time;       // block timestamp of the original post
        uint40 edited;     // 0 = never edited, else the timestamp of the last edit
        uint256 replyTo;   // parent chirp id, or 0 for a top-level chirp
        string body;       // the text, <= 280 bytes
    }

    /// @notice Chirps by id, 1..count. Id 0 is never used, so replyTo == 0 always
    ///         means "top level". No constructor writes any storage.
    uint256 public count;
    mapping(uint256 => Chip) internal _chirps;

    mapping(uint256 => uint256) public likeCount;                 // chirp id -> likes
    mapping(uint256 => mapping(address => bool)) public liked;    // chirp id -> who liked

    mapping(address => mapping(uint256 => bool)) public follows;  // follower -> mask -> following?
    mapping(uint256 => uint256) public followerCount;             // mask -> followers
    mapping(uint256 => uint256) public chirpCount;                // mask -> chirps posted

    // ----------------------------------------------------------------- post
    /// @param mask    a peoplebook token you own; you post as its identity
    /// @param body    the text, 1..280 bytes
    /// @param replyTo a chirp id you're replying to, or 0 for a top-level chirp
    function chirp(uint256 mask, string calldata body, uint256 replyTo) external returns (uint256 id) {
        uint256 n = bytes(body).length;
        if (n == 0 || n > 280) revert BadLength();
        if (PEOPLEBOOK.ownerOf(mask) != msg.sender) revert NotYourMask();
        if (replyTo != 0 && replyTo > count) revert NoChirp(replyTo);

        id = ++count;
        _chirps[id] = Chip(mask, msg.sender, uint40(block.timestamp), 0, replyTo, body);
        unchecked { chirpCount[mask]++; }
        emit Chirped(id, mask, msg.sender, replyTo, body);
    }

    /// @notice Rewrite a chirp you posted (mutable, but on chain): the body is
    ///         replaced and an `edited` timestamp stamped. Author only.
    function edit(uint256 id, string calldata body) external {
        if (id == 0 || id > count) revert NoChirp(id);
        uint256 n = bytes(body).length;
        if (n == 0 || n > 280) revert BadLength();
        Chip storage c = _chirps[id];
        if (c.author != msg.sender) revert NotAuthor();
        c.body = body;
        c.edited = uint40(block.timestamp);
        emit Edited(id, body, c.edited);
    }

    // ----------------------------------------------------------------- like
    function like(uint256 id) external {
        if (id == 0 || id > count) revert NoChirp(id);
        if (liked[id][msg.sender]) revert AlreadyLiked();
        liked[id][msg.sender] = true;
        uint256 c = ++likeCount[id];
        emit Liked(id, msg.sender, true, c);
    }

    function unlike(uint256 id) external {
        if (!liked[id][msg.sender]) revert NotLiked();
        liked[id][msg.sender] = false;
        uint256 c = --likeCount[id];
        emit Liked(id, msg.sender, false, c);
    }

    // --------------------------------------------------------------- follow
    /// @notice Follow (or unfollow) a mask. Your timeline is whatever the masks
    ///         you follow have chirped — assembled by the reader from these.
    function follow(uint256 mask, bool on) external {
        if (follows[msg.sender][mask] == on) return;
        follows[msg.sender][mask] = on;
        if (on) { unchecked { followerCount[mask]++; } }
        else if (followerCount[mask] != 0) { unchecked { followerCount[mask]--; } }
        emit Followed(msg.sender, mask, on, followerCount[mask]);
    }

    // ----------------------------------------------------------------- reads
    /// @notice The value-type fields of a chirp (no strings), so the getter stays
    ///         simple. Pair with body() for the text. The reader paginates by
    ///         walking ids from `count` downward.
    function meta(uint256 id) external view returns (
        uint256 mask, address author, uint40 time, uint40 edited, uint256 replyTo, uint256 likes
    ) {
        if (id == 0 || id > count) revert NoChirp(id);
        Chip storage c = _chirps[id];
        return (c.mask, c.author, c.time, c.edited, c.replyTo, likeCount[id]);
    }

    /// @notice The text of a chirp.
    function body(uint256 id) external view returns (string memory) {
        if (id == 0 || id > count) revert NoChirp(id);
        return _chirps[id].body;
    }
}
