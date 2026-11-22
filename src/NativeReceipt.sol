// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice Builds the note sent to the Native receipt book and checks the book's reply.
/// The book is `qday-receipts` (CosmWasm). Its reply to `record` is the stored receipt as JSON:
/// {"id":N,"sender":"qor1...","note":"...","height":H}
library NativeReceipt {
    uint256 internal constant MAX_MEMO = 256;

    error BadMemo();
    error ReplyMismatch();

    bytes16 private constant HEX = "0123456789abcdef";

    /// @dev "haven-ledger v1 n=<nonce> c=0x<commitment>" and, if a memo was signed, " m=<memo>".
    function note(uint256 nonce, bytes32 commitment, string memory memo) internal pure returns (string memory) {
        string memory base = string.concat("haven-ledger v1 n=", decimal(nonce), " c=", hex32(commitment));
        if (bytes(memo).length == 0) return base;
        return string.concat(base, " m=", memo);
    }

    function recordPayload(string memory text) internal pure returns (bytes memory) {
        return bytes(string.concat('{"record":{"note":"', text, '"}}'));
    }

    /// @dev Printable ASCII with no quote and no backslash, so it cannot leave the JSON string,
    /// and no space at either end, because the book trims the note and the echo would differ.
    /// The book's own 140-character limit is not repeated here: if it refuses, the payout reverts.
    function checkMemo(string memory memo) internal pure {
        bytes memory m = bytes(memo);
        if (m.length > MAX_MEMO) revert BadMemo();
        if (m.length == 0) return;
        if (m[0] == " " || m[m.length - 1] == " ") revert BadMemo();
        for (uint256 i = 0; i < m.length; i++) {
            bytes1 b = m[i];
            if (b < 0x20 || b > 0x7e || b == '"' || b == "\\") revert BadMemo();
        }
    }

    /// @notice Accepts the reply only if it names `account` as sender and echoes `text` exactly.
    /// @return id The receipt id the book assigned.
    /// @return height The block height the book stored.
    function check(bytes memory reply, string memory account, string memory text)
        internal
        pure
        returns (uint64 id, uint64 height)
    {
        uint256 at = _expect(reply, 0, '{"id":');
        (id, at) = _number(reply, at);
        at = _expect(reply, at, ',"sender":"');
        at = _expect(reply, at, bytes(account));
        at = _expect(reply, at, '","note":"');
        at = _expect(reply, at, bytes(text));
        at = _expect(reply, at, '","height":');
        (height, at) = _number(reply, at);
        at = _expect(reply, at, "}");
        if (at != reply.length) revert ReplyMismatch();
    }

    function decimal(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 digits;
        for (uint256 v = value; v != 0; v /= 10) {
            digits++;
        }
        bytes memory out = new bytes(digits);
        for (uint256 i = digits; i > 0; i--) {
            out[i - 1] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(out);
    }

    function hex32(bytes32 value) internal pure returns (string memory) {
        bytes memory out = new bytes(66);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i = 0; i < 32; i++) {
            uint8 b = uint8(value[i]);
            out[2 + 2 * i] = HEX[b >> 4];
            out[3 + 2 * i] = HEX[b & 15];
        }
        return string(out);
    }

    function _expect(bytes memory data, uint256 at, bytes memory want) private pure returns (uint256) {
        if (data.length < at + want.length) revert ReplyMismatch();
        for (uint256 i = 0; i < want.length; i++) {
            if (data[at + i] != want[i]) revert ReplyMismatch();
        }
        return at + want.length;
    }

    /// @dev A JSON unsigned integer that fits in 64 bits, with no leading zero.
    function _number(bytes memory data, uint256 at) private pure returns (uint64 value, uint256 next) {
        uint256 start = at;
        uint256 acc;
        while (at < data.length && data[at] >= "0" && data[at] <= "9") {
            acc = acc * 10 + (uint8(data[at]) - 48);
            if (acc > type(uint64).max) revert ReplyMismatch();
            at++;
        }
        if (at == start) revert ReplyMismatch();
        if (at - start > 1 && data[start] == "0") revert ReplyMismatch();
        return (uint64(acc), at);
    }
}
