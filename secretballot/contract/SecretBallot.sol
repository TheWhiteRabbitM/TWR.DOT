// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPeoplebook {
    function ownerOf(uint256 id) external view returns (address);
}

/**
 * A secret ballot with a public count.
 *
 * Governance on chain currently asks you to choose between two things nobody
 * should have to trade. Either the tally is verifiable and every ballot is
 * public — so votes can be bought, because a buyer can check what he paid for,
 * and pressure works, because an employer can look — or the ballot is private
 * and you are trusting somebody's server to count honestly. The secret ballot
 * with a public count is the oldest solved problem in democracy and one of the
 * newest unsolved ones here.
 *
 * The other half is weight. Token-weighted voting is not a design choice, it is
 * what you are forced into when identities are free: one person can be ten
 * thousand wallets, so the only scarce thing left to count is money. Give the
 * chain a way to know one human from ten thousand and one-person-one-vote
 * becomes possible for the first time.
 *
 * This contract does both. Enrolling checks a mask, which is where identity is
 * used and the last moment it appears. Voting carries no identity at all: it
 * carries a linkable ring signature proving the voter is one of the enrolled,
 * without saying which. The proof includes a key image, a value that is the same
 * every time that voter signs in this poll and tells you nothing about who they
 * are, so a second ballot from the same person is refused while the first stays
 * anonymous.
 *
 * There is no trusted setup and no ceremony, because the scheme is plain
 * elliptic curve arithmetic over bn254 — pallet-revive exposes 0x06 to add
 * points, 0x07 to multiply one and 0x05 for the modular exponentiation that
 * hashing onto the curve needs. The scheme (bLSAG) is well known; verifying it
 * inside a contract on this chain does not appear to have been done before.
 */
contract SecretBallot {
    /* bn254 G1: y^2 = x^3 + 3 over F_p */
    uint256 internal constant P = 21888242871839275222246405745257275088696311157297823662689037894645226208583;
    /* group order: scalars are taken modulo this */
    uint256 internal constant Q = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    IPeoplebook public immutable PEOPLEBOOK;

    struct Poll {
        uint256 opener;
        uint64 at;
        bool closedRing;
        string question;
        string[] options;
        uint256[2][] ring;
    }

    Poll[] private _polls;
    mapping(uint256 => mapping(uint256 => bool)) public enrolled;   // poll => mask
    mapping(uint256 => mapping(bytes32 => bool)) public used;       // poll => key image
    mapping(uint256 => mapping(uint8 => uint32)) public tally;      // poll => option
    mapping(uint256 => uint32) public ballots;

    uint64 public lastChangedAt;

    event Asked(uint256 indexed id, uint256 indexed mask, string question);
    event Enrolled(uint256 indexed id, uint256 ringSize);
    event Cast(uint256 indexed id, uint8 option, bytes32 keyImage);

    error NotYourMask();
    error NoSuchPoll();
    error AlreadyEnrolled();
    error RingClosed();
    error RingTooSmall();
    error BadOption();
    error BadSignature();
    error AlreadyVoted();
    error NotOnCurve();
    error PointNotOnCurve();

    constructor(address peoplebook) {
        PEOPLEBOOK = IPeoplebook(peoplebook);
    }

    /* ------------------------------------------------------ curve, on chain -- */

    /** Add two points with the bn254 precompile. Infinity is (0,0) here. */
    function _add(uint256[2] memory a, uint256[2] memory b) internal view returns (uint256[2] memory r) {
        uint256[4] memory input = [a[0], a[1], b[0], b[1]];
        bool ok;
        assembly {
            ok := staticcall(gas(), 6, input, 128, r, 64)
        }
        if (!ok) revert BadSignature();
    }

    /** Multiply a point by a scalar. */
    function _mul(uint256[2] memory a, uint256 s) internal view returns (uint256[2] memory r) {
        uint256[3] memory input = [a[0], a[1], s];
        bool ok;
        assembly {
            ok := staticcall(gas(), 7, input, 96, r, 64)
        }
        if (!ok) revert BadSignature();
    }

    /** b^e mod m, which is how a square root is taken in this field. */
    function _expmod(uint256 b, uint256 e, uint256 m) internal view returns (uint256 o) {
        uint256[6] memory input = [uint256(32), 32, 32, b, e, m];
        uint256[1] memory out;
        bool ok;
        assembly {
            ok := staticcall(gas(), 5, input, 192, out, 32)
        }
        if (!ok) revert BadSignature();
        o = out[0];
    }

    /**
     * Hash a public key onto the curve.
     *
     * The key image is x·H(P) rather than x·G, and the security of that rests on
     * nobody knowing the discrete log of H(P). Try-and-increment gets there: take
     * a hash as an x coordinate, ask whether x^3+3 is a square, and step along
     * until it is. p is 3 mod 4, so the square root is one exponentiation.
     */
    function _hashToPoint(uint256[2] memory pk) internal view returns (uint256[2] memory) {
        uint256 x = uint256(keccak256(abi.encodePacked("bLSAG:H2C:bn254", pk[0], pk[1]))) % P;
        for (uint256 i = 0; i < 256; i++) {
            uint256 y2 = addmod(mulmod(mulmod(x, x, P), x, P), 3, P);
            uint256 y = _expmod(y2, (P + 1) / 4, P);
            if (mulmod(y, y, P) == y2) return [x, y];
            x = addmod(x, 1, P);
        }
        revert NotOnCurve();
    }

    function _onCurve(uint256[2] memory pt) internal pure returns (bool) {
        if (pt[0] >= P || pt[1] >= P) return false;
        return mulmod(pt[1], pt[1], P) == addmod(mulmod(mulmod(pt[0], pt[0], P), pt[0], P), 3, P);
    }

    /**
     * Verify a linkable ring signature.
     *
     * For each member the challenge is re-derived from the two points a signer
     * could only have produced knowing one private key in the ring, and the chain
     * of challenges has to close on itself. It closes only if exactly one of the
     * keys was known, and which one leaves no trace anywhere in the arithmetic.
     */
    function verify(
        bytes32 message,
        uint256[2][] memory ring,
        uint256 c0,
        uint256[] memory s,
        uint256[2] memory keyImage
    ) public view returns (bool) {
        uint256 n = ring.length;
        if (n < 2 || s.length != n) return false;
        if (!_onCurve(keyImage)) return false;

        uint256[2] memory G = [uint256(1), uint256(2)];
        uint256 c = c0;
        for (uint256 i = 0; i < n; i++) {
            if (s[i] >= Q || c >= Q) return false;
            // L = s·G + c·P_i
            uint256[2] memory L = _add(_mul(G, s[i]), _mul(ring[i], c));
            // R = s·H(P_i) + c·I
            uint256[2] memory R = _add(_mul(_hashToPoint(ring[i]), s[i]), _mul(keyImage, c));
            c = uint256(keccak256(abi.encodePacked(message, L[0], L[1], R[0], R[1]))) % Q;
        }
        return c == c0;
    }

    /* ------------------------------------------------------------ asking -- */

    /** Open a question. Anything can be asked; what matters is who may answer. */
    function ask(uint256 mask, string calldata question, string[] calldata options)
        external
        returns (uint256 id)
    {
        if (PEOPLEBOOK.ownerOf(mask) != msg.sender) revert NotYourMask();
        if (options.length < 2 || options.length > 8) revert BadOption();
        id = _polls.length;
        Poll storage p = _polls.push();
        p.opener = mask;
        p.at = uint64(block.number);
        p.question = question;
        for (uint256 i = 0; i < options.length; i++) p.options.push(options[i]);
        lastChangedAt = uint64(block.number);
        emit Asked(id, mask, question);
    }

    /**
     * Join the ring.
     *
     * This is the only place a mask is checked, and it happens before anyone has
     * said anything. From here on the poll knows how many people may vote and
     * nothing about which of them did what.
     */
    function enrol(uint256 id, uint256 mask, uint256[2] calldata pubkey) external {
        Poll storage p = _at(id);
        if (PEOPLEBOOK.ownerOf(mask) != msg.sender) revert NotYourMask();
        if (enrolled[id][mask]) revert AlreadyEnrolled();
        if (p.closedRing) revert RingClosed();
        if (!_onCurve([pubkey[0], pubkey[1]])) revert PointNotOnCurve();
        enrolled[id][mask] = true;
        p.ring.push([pubkey[0], pubkey[1]]);
        lastChangedAt = uint64(block.number);
        emit Enrolled(id, p.ring.length);
    }

    /**
     * Vote.
     *
     * Note what this function does not take: a mask, a name, an account that
     * means anything. It takes a proof that the sender is one of the enrolled
     * and a key image that stops them being two of them. Anyone may submit it,
     * including on somebody else's behalf, because the ballot defends itself.
     *
     * The first vote closes the ring. A ring that grows after voting has begun
     * would let the anonymity set be manipulated around a ballot already cast.
     */
    function cast(
        uint256 id,
        uint8 option,
        uint256 c0,
        uint256[] calldata s,
        uint256[2] calldata keyImage
    ) external {
        Poll storage p = _at(id);
        if (option >= p.options.length) revert BadOption();
        if (p.ring.length < 2) revert RingTooSmall();

        bytes32 image = keccak256(abi.encodePacked(keyImage[0], keyImage[1]));
        if (used[id][image]) revert AlreadyVoted();

        // the message binds the proof to this poll and this option, so a ballot
        // cannot be replayed onto another question or edited into another answer
        bytes32 message = keccak256(abi.encodePacked(address(this), id, option));
        if (!verify(message, p.ring, c0, s, [keyImage[0], keyImage[1]])) revert BadSignature();

        used[id][image] = true;
        tally[id][option] += 1;
        ballots[id] += 1;
        if (!p.closedRing) p.closedRing = true;
        lastChangedAt = uint64(block.number);
        emit Cast(id, option, image);
    }

    /* ------------------------------------------------------------- reads -- */

    function count() external view returns (uint256) {
        return _polls.length;
    }

    function meta(uint256 id)
        external
        view
        returns (uint256 opener, uint64 at, bool closedRing, uint256 ringSize, uint32 cast_, uint8 options)
    {
        Poll storage p = _at(id);
        return (p.opener, p.at, p.closedRing, p.ring.length, ballots[id], uint8(p.options.length));
    }

    function questionOf(uint256 id) external view returns (string memory) {
        return _at(id).question;
    }

    function optionsOf(uint256 id) external view returns (string[] memory) {
        return _at(id).options;
    }

    function ringOf(uint256 id) external view returns (uint256[2][] memory) {
        return _at(id).ring;
    }

    function tallies(uint256 id) external view returns (uint32[] memory out) {
        Poll storage p = _at(id);
        out = new uint32[](p.options.length);
        for (uint8 i = 0; i < p.options.length; i++) out[i] = tally[id][i];
    }

    /** The message a voter has to sign for a given answer. Exposed so a client
     *  never has to guess what the contract will check. */
    function ballotMessage(uint256 id, uint8 option) external view returns (bytes32) {
        return keccak256(abi.encodePacked(address(this), id, option));
    }

    function _at(uint256 id) private view returns (Poll storage) {
        if (id >= _polls.length) revert NoSuchPoll();
        return _polls[id];
    }
}
