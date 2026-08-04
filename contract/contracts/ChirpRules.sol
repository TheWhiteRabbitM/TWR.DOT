// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMasks {
    function ownerOf(uint256 id) external view returns (address);
}

/// @title ChirpRules — who may answer you, and who you have shut out
/// @notice READ THIS BEFORE TRUSTING IT. These rules are PUBLISHED on chain and
///         APPLIED BY CLIENTS. They are not enforced at write time, and this
///         contract cannot make them so.
///
///         The reason is plain: Chirp2 is already deployed and immutable. It has
///         no hook to consult, so nothing can stop a determined caller sending a
///         reply straight to Chirp2 and having it accepted. Any claim that a
///         block here makes a reply impossible would be false.
///
///         What it DOES give, which a normal social network cannot:
///
///           AUDITABLE   the rule is public. Anyone can read what you asked for
///                       and check whether a client honoured it. On X you are
///                       told the rule was applied and have no way to verify it.
///           YOURS       nobody can quietly change it — not an operator, not us.
///                       Only the mask holder writes it.
///           PORTABLE    every client reads the same rule. A second chirp client
///                       does not get to invent its own idea of your block list.
///
///         BLOCKING CANNOT HIDE YOU. Every chirp is public storage on a public
///         chain; someone you block can still read every word you write, and
///         pretending otherwise would be the dishonest part. What a block does
///         here is precise: conforming clients will not let them reply to you,
///         quote you, or reach your notifications. That is less than the block
///         you are used to — and it is exactly what is true.
/// @custom:cdm @thebutton/chirprules
contract ChirpRules {
    error NotYourMask();
    error BadPolicy(uint8 policy);
    error CannotBlockYourself();

    /// Who may reply to chirps posted by this mask.
    /// 0 EVERYONE   the default, and what applies to a mask that never wrote here
    /// 1 FOLLOWING  only masks the author follows
    /// 2 MENTIONED  only masks named in the chirp
    uint8 public constant EVERYONE = 0;
    uint8 public constant FOLLOWING = 1;
    uint8 public constant MENTIONED = 2;

    event PolicySet(uint256 indexed mask, uint8 policy);
    event BlockSet(uint256 indexed mask, uint256 indexed other, bool on);

    IMasks public constant MASKS = IMasks(0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a);

    /// mask => reply policy. Absent means EVERYONE, so silence is the open door.
    mapping(uint256 => uint8) public replyPolicy;

    /// mask => the mask it has blocked => true
    mapping(uint256 => mapping(uint256 => bool)) public blocked;

    /// mask => how many it has blocked, so a client can skip the walk when it is 0
    mapping(uint256 => uint256) public blockCount;

    function setReplyPolicy(uint256 mask, uint8 policy) external {
        if (MASKS.ownerOf(mask) != msg.sender) revert NotYourMask();
        if (policy > MENTIONED) revert BadPolicy(policy);
        replyPolicy[mask] = policy;
        emit PolicySet(mask, policy);
    }

    /// @param mask a mask you hold
    /// @param other the mask you are shutting out, or letting back in
    function setBlocked(uint256 mask, uint256 other, bool on) external {
        if (MASKS.ownerOf(mask) != msg.sender) revert NotYourMask();
        if (mask == other) revert CannotBlockYourself();
        bool was = blocked[mask][other];
        if (was == on) return;                       // nothing to write, nothing to charge for
        blocked[mask][other] = on;
        if (on) blockCount[mask] += 1;
        else blockCount[mask] -= 1;
        emit BlockSet(mask, other, on);
    }

    /// @notice Both directions at once: a conversation is off if EITHER side
    ///         blocked the other. Clients ask this rather than two questions,
    ///         because forgetting the second one is how a block leaks.
    function eitherBlocked(uint256 a, uint256 b) external view returns (bool) {
        return blocked[a][b] || blocked[b][a];
    }

    /// @notice Everything a client needs to decide, in one read.
    function rulesFor(uint256 mask) external view returns (uint8 policy, uint256 blocks) {
        return (replyPolicy[mask], blockCount[mask]);
    }
}
