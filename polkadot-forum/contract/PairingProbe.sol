// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * RISK-FIRST SPIKE for the anonymous mask court.
 *
 * The court needs jurors who can prove "I am one of the selected masks" WITHOUT
 * saying which one — otherwise cartels and retaliation are trivial. The standard
 * way to do that (Semaphore-style: merkle membership + nullifier, verified with
 * groth16) needs the bn254 PAIRING precompile at 0x08, callable FROM A CONTRACT.
 *
 * An eth_call from outside proving 0x08 exists is not enough: what matters is
 * whether a deployed PolkaVM contract can staticcall it and get a real answer.
 * So this contract does exactly that, twice:
 *
 *   pairEmpty()    — empty input must return 1 by definition (precompile reachable)
 *   pairIdentity() — e(G1,G2)*e(-G1,G2) == 1, an actual pairing computation
 *
 * Both true => groth16 verification is feasible here => the anonymous jury is
 * buildable. Either false => fall back to a non-ZK design (known jurors, secret
 * ballot by commit-reveal) and say so plainly.
 */
contract PairingProbe {
    /// bn254 base field prime.
    uint256 private constant P =
        21888242871839275222246405745257275088696311157297823662689037894645226208583;

    address private constant PAIRING = address(0x08);

    /// The pairing precompile answers an empty input with `true`.
    function pairEmpty() external view returns (bool ok, bool called, uint256 raw) {
        (bool success, bytes memory out) = PAIRING.staticcall("");
        called = success;
        if (success && out.length == 32) {
            raw = abi.decode(out, (uint256));
            ok = raw == 1;
        }
    }

    /// A real pairing check computed on chain: e(G1,G2) * e(-G1,G2) == 1.
    /// G2 words are in EIP-197 order (imaginary part first).
    function pairIdentity() external view returns (bool ok, bool called, uint256 raw) {
        uint256[12] memory input;

        // pair 1 — G1 = (1, 2)
        input[0] = 1;
        input[1] = 2;
        input[2] = 11559732032986387107991004021392285783925812861821192530917403151452391805634; // x_im
        input[3] = 10857046999023057135944570762232829481370756359578518086990519993285655852781; // x_re
        input[4] = 4082367875863433681332203403145435568316851327593401208105741076214120093531; // y_im
        input[5] = 8495653923123431417604973247489272438418190587263600148770280649306958101930; // y_re

        // pair 2 — -G1 = (1, P-2), same G2. The two pairings cancel.
        input[6] = 1;
        input[7] = P - 2;
        input[8] = input[2];
        input[9] = input[3];
        input[10] = input[4];
        input[11] = input[5];

        (bool success, bytes memory out) = PAIRING.staticcall(abi.encodePacked(input));
        called = success;
        if (success && out.length == 32) {
            raw = abi.decode(out, (uint256));
            ok = raw == 1;
        }
    }
}
