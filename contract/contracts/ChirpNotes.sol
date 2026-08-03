// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMasks {
    function ownerOf(uint256 id) external view returns (address);
}

/// @title ChirpNotes - context on a chirp, kept only when people who disagree agree
/// @notice Community Notes, with the part X cannot do.
///
///         The hard problem in a system like this is not writing notes, it is
///         that a note which simply collects the most votes is a note that
///         collects the largest faction. X's answer is a bridging model: fit
///         every rater and every note on a latent axis, and keep the note whose
///         helpfulness survives AFTER that axis is accounted for - which in
///         practice means it was rated helpful by people who sit on opposite
///         sides of it.
///
///         That model is gradient descent over floats. It cannot run here, and
///         it does not need to. Every rating is a public row on this chain, so
///         the score is computed by the reader's own client and ANY reader can
///         recompute it and get the same answer. X publishes code and periodic
///         data dumps and asks you to trust the join between them; here the data
///         IS the chain. This contract therefore stores facts and refuses to
///         store a verdict - `status` is deliberately absent.
///
///         What the contract does own is the thing the model assumes and X can
///         only estimate: that one rater is one person. A mask is account-bound
///         and non-transferable, so `one mask, one rating` is enforced rather
///         than approximated.
///
///         Anyone holding a mask may write a note and rate one, including on
///         their own chirp: a rule against self-defence would be trivially
///         sidestepped with a second account on any other system, and here it
///         would only stop the honest case - an author adding the correction
///         themselves. The bridging model already discounts a lone voice.
/// @custom:cdm @thebutton/chirpnotes
contract ChirpNotes {
    error NotYourMask();
    error NoNote(uint256 id);
    error NotAuthor();
    error BadLength();
    error AlreadyNoted();
    error AlreadyRated();
    error BadRating();
    error Gone();

    event Noted(uint256 indexed id, uint256 indexed chirpId, uint256 indexed mask, uint8 kind);
    event Edited(uint256 indexed id, uint40 at);
    event Retracted(uint256 indexed id);
    event Rated(uint256 indexed id, uint256 indexed mask, uint8 value);

    IMasks public constant MASKS = IMasks(0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a);

    /// 0 = adds missing context, 1 = says the chirp is misleading. Kept as a
    /// number rather than a free string so the two can never drift into
    /// synonyms, and so a client can group them without parsing prose.
    uint8 public constant CONTEXT = 0;
    uint8 public constant MISLEADING = 1;

    /// 0 = not helpful, 1 = somewhat, 2 = helpful. Three levels, because the
    /// bridging model needs the middle one: a rater who only ever says yes or no
    /// carries no information about where they sit.
    uint8 public constant NOT_HELPFUL = 0;
    uint8 public constant HELPFUL = 2;

    struct Note {
        uint256 chirpId;
        uint256 mask;
        address author;
        uint40 time;
        uint40 edited;
        bool retracted;
        uint8 kind;
        string body;
    }

    struct Rating {
        uint256 noteId;
        uint256 mask;
        uint8 value;
    }

    uint256 public count;
    mapping(uint256 => Note) internal _notes;

    /// One note per mask per chirp, so a single person cannot bury a post under
    /// their own repeated context.
    mapping(uint256 => mapping(uint256 => bool)) public noted;

    /// The notes on a chirp, so a client does not have to walk all of them.
    mapping(uint256 => uint256[]) internal _byChirp;

    /// EVERY rating, in one flat log. The scorer needs the whole (rater, note,
    /// value) matrix and nothing less - a per-note list would cost one round
    /// trip per note to assemble the same thing.
    Rating[] internal _ratings;
    mapping(uint256 => mapping(uint256 => bool)) public rated;
    mapping(uint256 => uint256) public ratingCount;

    /// @param chirpId the chirp this is about; unchecked on purpose, since
    ///        Chirp2 is a separate contract and a note on a post that does not
    ///        exist simply never surfaces
    /// @param mask    a mask you hold; it is the byline
    /// @param kind    CONTEXT or MISLEADING
    /// @param body    up to 700 bytes - a note has to fit its reasoning and a source
    function add(uint256 chirpId, uint256 mask, uint8 kind, string calldata body)
        external
        returns (uint256 id)
    {
        if (MASKS.ownerOf(mask) != msg.sender) revert NotYourMask();
        if (kind > MISLEADING) revert BadRating();
        uint256 n = bytes(body).length;
        if (n == 0 || n > 700) revert BadLength();
        if (noted[chirpId][mask]) revert AlreadyNoted();

        noted[chirpId][mask] = true;
        id = ++count;
        _notes[id] = Note(chirpId, mask, msg.sender, uint40(block.timestamp), 0, false, kind, body);
        _byChirp[chirpId].push(id);
        emit Noted(id, chirpId, mask, kind);
    }

    /// @notice Correct your own note. Ratings are deliberately NOT cleared: a
    ///         note whose ratings reset on every edit could be walked past the
    ///         threshold one word at a time. The edit timestamp is public, so a
    ///         client can show that the text moved under the votes.
    function edit(uint256 id, string calldata body) external {
        Note storage e = _live(id);
        if (e.author != msg.sender) revert NotAuthor();
        uint256 n = bytes(body).length;
        if (n == 0 || n > 700) revert BadLength();
        e.body = body;
        e.edited = uint40(block.timestamp);
        emit Edited(id, e.edited);
    }

    /// @notice Withdraw your own note.
    function retract(uint256 id) external {
        Note storage e = _live(id);
        if (e.author != msg.sender) revert NotAuthor();
        e.retracted = true;
        emit Retracted(id);
    }

    /// @notice Say whether a note helped. One per mask per note, and final: a
    ///         rating you can change is a rating you can hold back until you see
    ///         which way it is going.
    function rate(uint256 id, uint256 mask, uint8 value) external {
        _live(id);
        if (MASKS.ownerOf(mask) != msg.sender) revert NotYourMask();
        if (value > HELPFUL) revert BadRating();
        if (rated[id][mask]) revert AlreadyRated();
        rated[id][mask] = true;
        _ratings.push(Rating(id, mask, value));
        ratingCount[id] += 1;
        emit Rated(id, mask, value);
    }

    // ----------------------------------------------------------------- reads

    /// @dev Value types only. The body is fetched apart, because a getter
    ///      returning several dynamic types is rejected at instantiation on
    ///      PolkaVM - learned the hard way, and written down in PeopleWiki.
    function meta(uint256 id)
        external
        view
        returns (
            uint256 chirpId,
            uint256 mask,
            address author,
            uint40 time,
            uint40 edited,
            bool retracted,
            uint8 kind,
            uint256 ratings
        )
    {
        if (id == 0 || id > count) revert NoNote(id);
        Note storage e = _notes[id];
        return (e.chirpId, e.mask, e.author, e.time, e.edited, e.retracted, e.kind, ratingCount[id]);
    }

    function body(uint256 id) external view returns (string memory) {
        if (id == 0 || id > count) revert NoNote(id);
        return _notes[id].body;
    }

    /// @notice The notes on one chirp. A single dynamic array is fine; several
    ///         are not.
    function notesOf(uint256 chirpId) external view returns (uint256[] memory) {
        return _byChirp[chirpId];
    }

    function totalRatings() external view returns (uint256) {
        return _ratings.length;
    }

    /// @notice One row of the rating matrix. The scorer walks 0..totalRatings-1
    ///         and rebuilds the whole thing, which is what makes the ranking
    ///         reproducible by anyone rather than announced by us.
    function ratingAt(uint256 i) external view returns (uint256 noteId, uint256 mask, uint8 value) {
        Rating storage r = _ratings[i];
        return (r.noteId, r.mask, r.value);
    }

    function _live(uint256 id) private view returns (Note storage e) {
        if (id == 0 || id > count) revert NoNote(id);
        e = _notes[id];
        if (e.retracted) revert Gone();
    }
}
