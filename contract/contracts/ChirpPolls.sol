// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMasks {
    function ownerOf(uint256 id) external view returns (address);
}

/// @title ChirpPolls — a poll whose result anyone can recount
/// @notice This is the one feature where being on a chain is not a detail but
///         the entire point.
///
///         A poll on a normal social network gives you a number the operator
///         computed. You cannot recount it, you cannot see who voted, you cannot
///         tell whether it was touched, and you would not know if it had been.
///         Every poll ever run there asks you to take the result on trust.
///
///         Here a vote is a row. `tally` is derived from those rows and nothing
///         else, `votedBy` will tell any caller what a given account chose, and
///         the whole thing is public storage on Asset Hub. If somebody disputes
///         a result they do not have to argue — they can add it up themselves.
///
///         DOUBLE VOTING is refused rather than deduplicated after the fact:
///         one account, one vote, and changing your mind moves the vote instead
///         of adding one. Sock puppets are not solved here — an account is free
///         to make. They are solved by binding a mask to a person, which is the
///         individuality chain's job, not this contract's. What this contract
///         guarantees is narrower and worth stating plainly: the arithmetic is
///         honest, whoever is doing the voting.
/// @custom:cdm @thebutton/chirppolls
contract ChirpPolls {
    error NotYourMask();
    error NoPoll(uint256 id);
    error BadOptions(uint256 n);
    error OptionTooLong();
    error Closed();
    error NoSuchOption(uint8 option);
    error AlreadyHasPoll(uint256 chirpId);

    event Created(uint256 indexed id, uint256 indexed chirpId, uint256 indexed mask, uint40 closesAt);
    event Voted(uint256 indexed id, address indexed voter, uint8 option);

    IMasks public constant MASKS = IMasks(0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a);

    /// Two to four, the same shape X uses. One option is not a question and
    /// five does not fit a phone without becoming a list.
    uint8 public constant MIN_OPTIONS = 2;
    uint8 public constant MAX_OPTIONS = 4;
    uint256 public constant MAX_OPTION_LEN = 40;

    struct Poll {
        uint256 chirpId;    // the chirp this poll belongs to
        uint256 mask;       // who asked
        uint40 closesAt;    // unix seconds; after this, voting reverts
        string[] options;
    }

    uint256 public count;
    mapping(uint256 => Poll) internal _polls;

    /// pollId => option index => how many chose it
    mapping(uint256 => mapping(uint8 => uint256)) public tally;
    /// pollId => voter => 1 + option index (0 means "has not voted")
    mapping(uint256 => mapping(address => uint8)) internal _vote;
    /// pollId => how many accounts have voted at all
    mapping(uint256 => uint256) public voters;
    /// chirpId => pollId, so a reader with a timeline can find polls in one pass
    mapping(uint256 => uint256) public pollOfChirp;

    /// @notice Attach a poll to a chirp you posted.
    /// @param chirpId the chirp that carries the question in its body
    /// @param mask a mask you hold
    /// @param options two to four short labels
    /// @param minutesOpen how long voting stays open, from now
    function create(uint256 chirpId, uint256 mask, string[] calldata options, uint32 minutesOpen)
        external
        returns (uint256 id)
    {
        if (MASKS.ownerOf(mask) != msg.sender) revert NotYourMask();
        if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) revert BadOptions(options.length);
        // One poll per chirp. Without this an author could stack polls on one
        // post and readers would have no way to say which one they answered.
        if (pollOfChirp[chirpId] != 0) revert AlreadyHasPoll(chirpId);
        for (uint256 i = 0; i < options.length; i++) {
            if (bytes(options[i]).length == 0 || bytes(options[i]).length > MAX_OPTION_LEN) revert OptionTooLong();
        }

        id = ++count;
        Poll storage p = _polls[id];
        p.chirpId = chirpId;
        p.mask = mask;
        p.closesAt = uint40(block.timestamp + uint256(minutesOpen) * 60);
        for (uint256 i = 0; i < options.length; i++) p.options.push(options[i]);

        pollOfChirp[chirpId] = id;
        emit Created(id, chirpId, mask, p.closesAt);
    }

    /// @notice Vote, or move a vote you already cast.
    /// @dev Moving rather than adding is why `tally` can never exceed `voters`.
    function vote(uint256 id, uint8 option) external {
        Poll storage p = _polls[id];
        if (p.closesAt == 0) revert NoPoll(id);
        if (block.timestamp >= p.closesAt) revert Closed();
        if (option >= p.options.length) revert NoSuchOption(option);

        uint8 prev = _vote[id][msg.sender];
        if (prev == 0) {
            voters[id] += 1;
        } else {
            if (prev - 1 == option) return;          // same answer; nothing to record
            tally[id][prev - 1] -= 1;
        }
        _vote[id][msg.sender] = option + 1;
        tally[id][option] += 1;
        emit Voted(id, msg.sender, option);
    }

    // ------------------------------------------------------------------ reads

    function pollOf(uint256 id)
        external
        view
        returns (uint256 chirpId, uint256 mask, uint40 closesAt, string[] memory options, uint256[] memory counts, uint256 total)
    {
        Poll storage p = _polls[id];
        chirpId = p.chirpId;
        mask = p.mask;
        closesAt = p.closesAt;
        options = p.options;
        counts = new uint256[](p.options.length);
        for (uint8 i = 0; i < p.options.length; i++) counts[i] = tally[id][i];
        total = voters[id];
    }

    /// @notice What this account chose: 0 = has not voted, otherwise 1 + index.
    /// @dev Deliberately public. A poll whose votes cannot be inspected is
    ///      exactly the poll this contract exists to replace.
    function votedBy(uint256 id, address who) external view returns (uint8) {
        return _vote[id][who];
    }

    function isOpen(uint256 id) external view returns (bool) {
        uint40 c = _polls[id].closesAt;
        return c != 0 && block.timestamp < c;
    }
}
