// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice The `qor1...` spelling of a 20-byte account. QoreChain's Native lane names an EVM
/// caller this way, so the ledger can recognise itself in the bridge's reply.
library Bech32 {
    bytes internal constant CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

    function qor(address account) internal pure returns (string memory) {
        uint256[39] memory values;
        // hrp "qor" expanded: high bits, a zero, low bits.
        values[0] = 3;
        values[1] = 3;
        values[2] = 3;
        values[3] = 0;
        values[4] = 0x71 & 31;
        values[5] = 0x6f & 31;
        values[6] = 0x72 & 31;

        uint160 raw = uint160(account);
        bytes memory out = new bytes(4 + 32 + 6);
        out[0] = "q";
        out[1] = "o";
        out[2] = "r";
        out[3] = "1";
        // 160 bits split exactly into 32 groups of 5, most significant first.
        for (uint256 i = 0; i < 32; i++) {
            uint256 group = (raw >> (155 - 5 * i)) & 31;
            values[7 + i] = group;
            out[4 + i] = CHARSET[group];
        }

        uint256 mod = _polymod(values) ^ 1;
        for (uint256 i = 0; i < 6; i++) {
            out[36 + i] = CHARSET[(mod >> (5 * (5 - i))) & 31];
        }
        return string(out);
    }

    /// @dev Values 0..38 are the hrp and data; the six checksum slots are fed as zeros.
    function _polymod(uint256[39] memory values) private pure returns (uint256 chk) {
        uint32[5] memory gen = [uint32(0x3b6a57b2), 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
        chk = 1;
        for (uint256 i = 0; i < 39 + 6; i++) {
            uint256 v = i < 39 ? values[i] : 0;
            uint256 top = chk >> 25;
            chk = ((chk & 0x1ffffff) << 5) ^ v;
            for (uint256 j = 0; j < 5; j++) {
                if ((top >> j) & 1 == 1) chk ^= gen[j];
            }
        }
    }
}
