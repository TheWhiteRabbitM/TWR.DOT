// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The peoplebook mask NFT: account-bound and non-transferable. Only its
///         owner check is used, and that is what makes a post unforgeable — a
///         mask cannot be squatted or bought, so posting as one means being the
///         account it belongs to. Same registry chirp and the complaint rail use.
interface IPeoplebook {
    function ownerOf(uint256 id) external view returns (address);
}

/// @title ForumBoard — a Polkadot forum with the whole conversation on chain
/// @notice The method is chirp's (Chirp2): everything lives in contract storage —
///         no server, no Bulletin, nothing to expire — and every write is gated
///         to a peoplebook mask you own. A microblog thread and a forum topic are
///         the same shape; this adds only what a forum needs on top of a chirp:
///         a TITLE and a CATEGORY on the root post, a longer body, and a paged
///         index so a reader can list topics by category in a couple of calls
///         (the DotDirectory paging pattern).
///
///           TOPIC  — a root post: title + category + body, replyTo/topicId = 0
///           REPLY  — topicId points at the topic; replyTo points at the post
///                    answered (0 = answering the topic itself)
///           LIKE   — one address, one like per post (toggle)
///           EDIT   — the author can rewrite; an `edited` stamp shows it changed
///           REMOVE — the author can retract; the row stays but reads as removed
///
///         There is no admin, no owner, no pause, and no moderator. Nobody —
///         including whoever deploys this — can delete or edit anyone else's
///         post. That is the entire point.
/// @custom:cdm @polkadot-forum/board
contract ForumBoard {
    // --------------------------------------------------------------- errors
    error BadLength();
    error NotYourMask();
    error NoPost(uint256 id);
    error NotATopic(uint256 id);
    error NotAuthor();
    error AlreadyLiked();
    error NotLiked();
    error AlreadyGone();

    // --------------------------------------------------------------- events
    event Posted(
        uint256 indexed id,
        uint256 indexed mask,
        address indexed author,
        uint256 topicId,
        uint256 replyTo,
        bytes32 categoryKey,
        string title
    );
    event Edited(uint256 indexed id, uint40 at);
    event Removed(uint256 indexed id);
    event Liked(uint256 indexed id, address indexed by, bool on, uint256 count);

    IPeoplebook public constant PEOPLEBOOK =
        IPeoplebook(0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a);

    uint256 public constant MAX_TITLE = 300;
    uint256 public constant MAX_BODY = 8000; // a long forum post; split anything larger

    struct Post {
        uint256 mask;
        address author;
        uint40 time;
        uint40 edited;
        uint256 topicId; // 0 means this post IS a topic (root)
        uint256 replyTo; // 0 = answering the topic itself
        bytes32 categoryKey; // only meaningful on a topic root
        bool deleted;
        string title; // only on a topic root
        string body;
    }

    uint256 public count; // total posts (topics + replies)
    mapping(uint256 => Post) internal _posts;

    mapping(uint256 => uint256) public likeCount;
    mapping(uint256 => mapping(address => bool)) public liked;
    /// @notice Replies counted on the topic root, so a card renders "12 replies"
    ///         without walking the feed.
    mapping(uint256 => uint256) public replyCount;
    mapping(uint256 => uint256) public postCountOf; // per mask

    /// @notice The paged index a forum needs and a microblog does not: every
    ///         topic id in creation order, and per category. `page()` over these
    ///         is the DotDirectory read pattern.
    uint256[] public topicIds;
    mapping(bytes32 => uint256[]) internal _byCategory;
    uint256 public lastChangedAt; // block of last write, so a reader re-pages once

    // ----------------------------------------------------------------- write
    /// @param mask        a peoplebook mask you own; you post as its identity
    /// @param categoryKey keccak256 of the category slug (topics group by it)
    function createTopic(
        uint256 mask,
        bytes32 categoryKey,
        string calldata title,
        string calldata body
    ) external returns (uint256 id) {
        uint256 t = bytes(title).length;
        uint256 b = bytes(body).length;
        if (t == 0 || t > MAX_TITLE || b == 0 || b > MAX_BODY) revert BadLength();
        if (PEOPLEBOOK.ownerOf(mask) != msg.sender) revert NotYourMask();

        id = ++count;
        _posts[id] = Post(mask, msg.sender, uint40(block.timestamp), 0, 0, 0, categoryKey, false, title, body);
        topicIds.push(id);
        _byCategory[categoryKey].push(id);
        unchecked {
            postCountOf[mask]++;
        }
        lastChangedAt = block.number;
        emit Posted(id, mask, msg.sender, 0, 0, categoryKey, title);
    }

    /// @param topicId the topic (root post) this reply belongs to
    /// @param replyTo the specific post being answered, or 0 for the topic itself
    function reply(
        uint256 mask,
        uint256 topicId,
        uint256 replyTo,
        string calldata body
    ) external returns (uint256 id) {
        uint256 b = bytes(body).length;
        if (b == 0 || b > MAX_BODY) revert BadLength();
        if (PEOPLEBOOK.ownerOf(mask) != msg.sender) revert NotYourMask();
        // topicId must be a live root post
        if (topicId == 0 || topicId > count || _posts[topicId].deleted) revert NoPost(topicId);
        if (_posts[topicId].topicId != 0) revert NotATopic(topicId);
        if (replyTo != 0 && (replyTo > count || _posts[replyTo].deleted)) revert NoPost(replyTo);

        id = ++count;
        _posts[id] = Post(mask, msg.sender, uint40(block.timestamp), 0, topicId, replyTo, bytes32(0), false, "", body);
        unchecked {
            replyCount[topicId]++;
            postCountOf[mask]++;
        }
        lastChangedAt = block.number;
        emit Posted(id, mask, msg.sender, topicId, replyTo, bytes32(0), "");
    }

    /// @notice Rewrite your own post; the body is replaced and an `edited` stamp
    ///         set so readers see it changed. Title stays (topics keep their name).
    function edit(uint256 id, string calldata body) external {
        Post storage p = _live(id);
        uint256 b = bytes(body).length;
        if (b == 0 || b > MAX_BODY) revert BadLength();
        if (p.author != msg.sender) revert NotAuthor();
        p.body = body;
        p.edited = uint40(block.timestamp);
        emit Edited(id, p.edited);
    }

    /// @notice Retract your own post. The row remains — nothing on chain truly
    ///         disappears — but it reads as removed and stops accepting replies.
    function remove(uint256 id) external {
        Post storage p = _live(id);
        if (p.author != msg.sender) revert NotAuthor();
        p.deleted = true;
        unchecked {
            if (p.topicId != 0 && replyCount[p.topicId] != 0) replyCount[p.topicId]--;
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

    // ----------------------------------------------------------------- reads
    /// @dev Value types only — a getter returning several dynamic arrays is
    ///      rejected at instantiation on PolkaVM, so title/body are fetched apart.
    function meta(uint256 id)
        external
        view
        returns (
            uint256 mask,
            address author,
            uint40 time,
            uint40 edited,
            uint256 topicId,
            uint256 replyTo,
            bytes32 categoryKey,
            bool deleted,
            uint256 likes,
            uint256 replies
        )
    {
        if (id == 0 || id > count) revert NoPost(id);
        Post storage p = _posts[id];
        return (p.mask, p.author, p.time, p.edited, p.topicId, p.replyTo, p.categoryKey, p.deleted, likeCount[id], replyCount[id]);
    }

    function title(uint256 id) external view returns (string memory) {
        if (id == 0 || id > count) revert NoPost(id);
        return _posts[id].title;
    }

    function body(uint256 id) external view returns (string memory) {
        if (id == 0 || id > count) revert NoPost(id);
        return _posts[id].body;
    }

    // --- paged topic index (DotDirectory pattern; single dynamic array is ok) ---
    function topicCount() external view returns (uint256) {
        return topicIds.length;
    }

    function categoryTopicCount(bytes32 categoryKey) external view returns (uint256) {
        return _byCategory[categoryKey].length;
    }

    /// @notice Topic ids in creation order, newest last. Reverse client-side to
    ///         show newest first; slice with start/size.
    function pageTopics(uint256 start, uint256 size) external view returns (uint256[] memory out) {
        out = _slice(topicIds, start, size);
    }

    function pageCategory(bytes32 categoryKey, uint256 start, uint256 size)
        external
        view
        returns (uint256[] memory out)
    {
        out = _slice(_byCategory[categoryKey], start, size);
    }

    function _slice(uint256[] storage arr, uint256 start, uint256 size)
        private
        view
        returns (uint256[] memory out)
    {
        uint256 total = arr.length;
        if (start >= total) return new uint256[](0);
        uint256 end = start + size;
        if (end > total) end = total;
        out = new uint256[](end - start);
        for (uint256 i = start; i < end; i++) out[i - start] = arr[i];
    }

    function _live(uint256 id) private view returns (Post storage p) {
        if (id == 0 || id > count) revert NoPost(id);
        p = _posts[id];
        if (p.deleted) revert AlreadyGone();
    }
}
