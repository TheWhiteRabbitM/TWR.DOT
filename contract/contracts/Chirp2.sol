// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The peoplebook mask NFT: account-bound and non-transferable. Only its
///         owner check is used here, and that is what makes a chirp unforgeable —
///         a mask cannot be squatted or bought, so posting as one means being the
///         account it belongs to.
interface IPeoplebook {
    function ownerOf(uint256 id) external view returns (address);
}

/// @title Chirp2 — the microblog, with the whole conversation on chain
/// @notice Everything lives in contract storage: no server, no Bulletin, nothing
///         to expire. The first version only had posting, editing and likes,
///         which left a feed nobody could answer. This one carries the acts that
///         make a timeline a conversation:
///
///           REPLY   — `replyTo` points at the chirp being answered
///           QUOTE   — `quoteOf` points at a chirp you are commenting on
///           REPOST  — a quote with an empty body: you are passing it on unchanged
///           DELETE  — the author can retract; the row stays but reads as removed
///
///         Counts are kept on the parent so a reader never has to scan the feed
///         to render "3 replies · 2 reposts".
/// @custom:cdm @thebutton/chirp2
contract Chirp2 {
    // --------------------------------------------------------------- errors
    error BadLength();
    error NotYourMask();
    error NoChirp(uint256 id);
    error NotAuthor();
    error AlreadyLiked();
    error NotLiked();
    error AlreadyGone();

    // --------------------------------------------------------------- events
    event Chirped(uint256 indexed id, uint256 indexed mask, address indexed author, uint256 replyTo, uint256 quoteOf, string body);
    event Edited(uint256 indexed id, string body, uint40 at);
    event Removed(uint256 indexed id);
    event Liked(uint256 indexed id, address indexed by, bool on, uint256 count);
    event Followed(address indexed follower, uint256 indexed mask, bool on, uint256 count);

    IPeoplebook public constant PEOPLEBOOK =
        IPeoplebook(0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a);

    struct Chip {
        uint256 mask;
        address author;
        uint40 time;
        uint40 edited;
        uint256 replyTo;   // 0 = top level
        uint256 quoteOf;   // 0 = not a quote; with an empty body it is a repost
        bool deleted;
        string body;
    }

    uint256 public count;
    mapping(uint256 => Chip) internal _chirps;

    mapping(uint256 => uint256) public likeCount;
    mapping(uint256 => mapping(address => bool)) public liked;
    /// @notice Replies and reposts counted on the PARENT, so a card can show its
    ///         totals without walking the whole feed.
    mapping(uint256 => uint256) public replyCount;
    mapping(uint256 => uint256) public repostCount;
    /// @notice The repost an account made of a chirp (0 = none), so the button is
    ///         a toggle: reposting again retracts the one you made.
    mapping(uint256 => mapping(address => uint256)) public repostOf;

    mapping(address => mapping(uint256 => bool)) public follows;
    mapping(uint256 => uint256) public followerCount;
    mapping(uint256 => uint256) public chirpCount;

    // ----------------------------------------------------------------- post
    /// @param mask    a peoplebook mask you own; you post as its identity
    /// @param body    1..280 bytes, or empty ONLY when quoting (that is a repost)
    /// @param replyTo the chirp you are answering, or 0
    /// @param quoteOf the chirp you are quoting, or 0
    function chirp(uint256 mask, string calldata body, uint256 replyTo, uint256 quoteOf)
        external
        returns (uint256 id)
    {
        uint256 n = bytes(body).length;
        // An empty body is only meaningful as a repost — otherwise it is noise.
        if (n > 280 || (n == 0 && quoteOf == 0)) revert BadLength();
        if (PEOPLEBOOK.ownerOf(mask) != msg.sender) revert NotYourMask();
        if (replyTo != 0 && (replyTo > count || _chirps[replyTo].deleted)) revert NoChirp(replyTo);
        if (quoteOf != 0 && (quoteOf > count || _chirps[quoteOf].deleted)) revert NoChirp(quoteOf);

        id = ++count;
        _chirps[id] = Chip(mask, msg.sender, uint40(block.timestamp), 0, replyTo, quoteOf, false, body);
        unchecked {
            chirpCount[mask]++;
            if (replyTo != 0) replyCount[replyTo]++;
            if (quoteOf != 0) {
                repostCount[quoteOf]++;
                if (n == 0) repostOf[quoteOf][msg.sender] = id; // a plain repost, so it can be undone
            }
        }
        emit Chirped(id, mask, msg.sender, replyTo, quoteOf, body);
    }

    /// @notice Rewrite your own chirp. The body is replaced and an `edited`
    ///         timestamp stamped, so readers can see it changed.
    function edit(uint256 id, string calldata body) external {
        Chip storage c = _live(id);
        uint256 n = bytes(body).length;
        if (n == 0 || n > 280) revert BadLength();
        if (c.author != msg.sender) revert NotAuthor();
        c.body = body;
        c.edited = uint40(block.timestamp);
        emit Edited(id, body, c.edited);
    }

    /// @notice Retract your own chirp. The row remains — nothing on chain truly
    ///         disappears — but it reads as removed and stops accepting replies.
    function remove(uint256 id) external {
        Chip storage c = _live(id);
        if (c.author != msg.sender) revert NotAuthor();
        c.deleted = true;
        unchecked {
            if (c.replyTo != 0 && replyCount[c.replyTo] != 0) replyCount[c.replyTo]--;
            if (c.quoteOf != 0) {
                if (repostCount[c.quoteOf] != 0) repostCount[c.quoteOf]--;
                if (repostOf[c.quoteOf][msg.sender] == id) repostOf[c.quoteOf][msg.sender] = 0;
            }
        }
        emit Removed(id);
    }

    // ----------------------------------------------------------------- like
    function like(uint256 id) external {
        _live(id);
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
    function follow(uint256 mask, bool on) external {
        if (follows[msg.sender][mask] == on) return;
        follows[msg.sender][mask] = on;
        if (on) { unchecked { followerCount[mask]++; } }
        else if (followerCount[mask] != 0) { unchecked { followerCount[mask]--; } }
        emit Followed(msg.sender, mask, on, followerCount[mask]);
    }

    // ----------------------------------------------------------------- reads
    /// @dev Value types only — a getter returning several dynamic arrays is
    ///      rejected at instantiation on PolkaVM, so the text is fetched apart.
    function meta(uint256 id) external view returns (
        uint256 mask,
        address author,
        uint40 time,
        uint40 edited,
        uint256 replyTo,
        uint256 quoteOf,
        bool deleted,
        uint256 likes,
        uint256 replies,
        uint256 reposts
    ) {
        if (id == 0 || id > count) revert NoChirp(id);
        Chip storage c = _chirps[id];
        return (c.mask, c.author, c.time, c.edited, c.replyTo, c.quoteOf, c.deleted, likeCount[id], replyCount[id], repostCount[id]);
    }

    function body(uint256 id) external view returns (string memory) {
        if (id == 0 || id > count) revert NoChirp(id);
        return _chirps[id].body;
    }

    function _live(uint256 id) private view returns (Chip storage c) {
        if (id == 0 || id > count) revert NoChirp(id);
        c = _chirps[id];
        if (c.deleted) revert AlreadyGone();
    }
}
