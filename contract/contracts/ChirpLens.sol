// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IChirp {
    function count() external view returns (uint256);
    function meta(uint256 id) external view returns (
        uint256 mask, address author, uint40 time, uint40 edited,
        uint256 replyTo, uint256 quoteOf, bool deleted,
        uint256 likes, uint256 replies, uint256 reposts
    );
    function body(uint256 id) external view returns (string memory);
    function liked(uint256 id, address who) external view returns (bool);
    function repostOf(uint256 id, address who) external view returns (uint256);
}

interface IMasks {
    function verifiedName(uint256 mask) external view returns (string memory);
    function tierOf(uint256 mask) external view returns (uint8);
    function profileOf(uint256 mask) external view returns (
        string memory displayName, string memory telegram, string memory x, string memory bio
    );
}

interface IHandles {
    function handleOf(uint256 mask) external view returns (string memory);
}

interface IPolls {
    function pollOfChirp(uint256 chirpId) external view returns (uint256);
}

interface IMedia {
    function infoOf(uint256 chirpId) external view returns (uint256 size, uint256 mask, string memory alt);
}

/// @title ChirpLens — one read where the app was making a thousand
/// @notice This contract stores nothing and changes nothing. It exists because
///         of an arithmetic problem in the client.
///
///         Rendering a timeline of 300 chirps costs, per chirp: `meta`, `body`,
///         and — for a signed-in reader — `liked` and `repostOf`. That is four
///         dry-run round trips each, 1200 for the page, before a single
///         identity is resolved. Every one is a separate JSON-RPC call over a
///         websocket, and the wait is not the chain's work but the count of
///         round trips. Adding `pollOfChirp` and `infoOf` for polls and
///         pictures made it six.
///
///         A contract calling another contract does not pay that price: the
///         reads happen inside one dry run, and only the result crosses the
///         wire. `CALL_STACK_DEPTH` bounds NESTING, not the number of sibling
///         calls, so a loop of N reads into Chirp2 sits at depth two however
///         long N is.
///
///         NOTHING ELSE CHANGES. Chirp2 is immutable and is not touched; this
///         only reads it through its public interface, exactly as the app does
///         today. If this contract were to disappear the app would still work,
///         one read at a time. That is deliberate — a convenience layer that
///         becomes load-bearing is a liability, and every address it reads is
///         fixed at deployment so it cannot be pointed somewhere else later.
///
///         The caller chooses the page size. Weight is what actually bounds it,
///         and the honest way to find the limit is to measure the returned
///         weight rather than pick a number that sounds safe.
/// @custom:cdm @thebutton/chirplens
contract ChirpLens {
    IChirp public constant CHIRP = IChirp(0x37A7CE834428636815b2746408343574aD13be7C);
    IMasks public constant MASKS = IMasks(0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a);
    IHandles public constant HANDLES = IHandles(0x7C61D99564C61e667C6Fd5D41aC2466327ea4109);
    IPolls public constant POLLS = IPolls(0x5b39063Dbef4Aa3E2Ea1ae75B863dA7F569796c3);
    IMedia public constant MEDIA = IMedia(0x02141Db68Fc4F70f724e8a72110951821f341e57);

    struct PostView {
        uint256 id;
        uint256 mask;
        address author;
        uint40 time;
        uint40 edited;
        uint256 replyTo;
        uint256 quoteOf;
        bool deleted;
        uint256 likes;
        uint256 replies;
        uint256 reposts;
        string body;
        /// Did the reader like it — false when no reader was given.
        bool liked;
        /// The reader's own repost of it, 0 for none.
        uint256 myRepost;
        /// Poll id attached to this chirp, 0 for none.
        uint256 pollId;
        /// Size of the attached picture in bytes, 0 for none — the bytes
        /// themselves are NOT returned, because a timeline should decide what to
        /// fetch rather than dragging every image through one response.
        uint256 mediaSize;
        /// The mask that attached the picture, for the caller's author check.
        uint256 mediaBy;
        string mediaAlt;
    }

    struct WhoView {
        uint256 mask;
        string name;
        string verified;
        string handle;
        uint8 tier;
        string telegram;
        string x;
        string bio;
    }

    /// @notice Everything the timeline needs about a page of chirps.
    /// @param ids the chirp ids to read, in the order they should come back
    /// @param me  the reader's H160, or the zero address for a signed-out view
    function posts(uint256[] calldata ids, address me) external view returns (PostView[] memory out) {
        out = new PostView[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) out[i] = one(ids[i], me);
    }

    /// @dev The body of the loop lives in its own frame deliberately. Destructuring
    ///      a ten-value tuple and then five more reads in one scope puts more than
    ///      sixteen slots within reach of the EVM stack, and the compiler answers
    ///      "stack too deep" — which resolc reports only as a missing artifact,
    ///      several layers downstream, with nothing naming this file.
    function one(uint256 id, address me) private view returns (PostView memory p) {
        p.id = id;
        (
            p.mask, p.author, p.time, p.edited,
            p.replyTo, p.quoteOf, p.deleted,
            p.likes, p.replies, p.reposts
        ) = CHIRP.meta(id);
        p.body = CHIRP.body(id);
        if (me != address(0)) {
            p.liked = CHIRP.liked(id, me);
            p.myRepost = CHIRP.repostOf(id, me);
        }
        p.pollId = POLLS.pollOfChirp(id);
        (p.mediaSize, p.mediaBy, p.mediaAlt) = MEDIA.infoOf(id);
    }

    /// @notice The identity behind each mask, in one call.
    /// @dev Four reads per mask became one round trip for the whole page. A
    ///      timeline of 300 chirps typically holds a few dozen distinct masks,
    ///      so the caller should deduplicate before calling — this does not,
    ///      because it cannot know which repeats the caller already has cached.
    function whos(uint256[] calldata masks) external view returns (WhoView[] memory out) {
        out = new WhoView[](masks.length);
        for (uint256 i = 0; i < masks.length; i++) {
            uint256 m = masks[i];
            WhoView memory w;
            w.mask = m;
            w.verified = MASKS.verifiedName(m);
            w.tier = MASKS.tierOf(m);
            (w.name, w.telegram, w.x, w.bio) = MASKS.profileOf(m);
            w.handle = HANDLES.handleOf(m);
            out[i] = w;
        }
    }

    /// @notice The newest `limit` ids, and the total, in one call — so the app
    ///         does not need a separate `count()` before it can ask for a page.
    function newest(uint256 limit) external view returns (uint256 total, uint256[] memory ids) {
        total = CHIRP.count();
        uint256 n = limit > total ? total : limit;
        ids = new uint256[](n);
        for (uint256 i = 0; i < n; i++) ids[i] = total - i;
    }
}
