// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Bech32} from "../../src/Bech32.sol";
import {NativeReceipt} from "../../src/NativeReceipt.sol";

/// @notice Etched at 0x...0901. Behaves like the CrossVM bridge calling `qday-receipts`, and can lie.
/// Foundry's EVM has no QoreChain bridge, so this is the only way to test both lanes locally.
contract FakeBridge {
    enum Mode {
        Honest,
        Inactive,
        RawReply,
        WrongSender,
        WrongNote,
        ExtraField
    }

    struct Receipt {
        string sender;
        string note;
        uint64 height;
    }

    Mode public mode;
    string public allowed;
    uint64 public count;
    mapping(uint64 => Receipt) internal book;

    function setMode(Mode m) external {
        mode = m;
    }

    function setAllowed(string calldata target) external {
        allowed = target;
    }

    function receipt(uint64 id) external view returns (Receipt memory) {
        return book[id];
    }

    function executeCrossVMCall(uint8 targetVM, string calldata target, bytes calldata payload)
        external
        returns (bytes memory)
    {
        if (mode == Mode.Inactive) {
            assembly {
                return(0, 0)
            }
        }
        require(targetVM == 1, "target VM must be QoreChain Native");
        if (keccak256(bytes(target)) != keccak256(bytes(allowed))) {
            revert(string.concat("cross-VM bridge call refused: target cosmwasm:", target, " is not allowlisted"));
        }
        string memory text = _noteOf(payload);
        uint256 len = bytes(text).length;
        if (len == 0 || len > 140) {
            revert(
                "cross-VM call failed: the note must be 1 to 140 characters: execute wasm contract failed: CosmWasm contract execution failed"
            );
        }

        count += 1;
        string memory sender = Bech32.qor(msg.sender);
        book[count] = Receipt(sender, text, uint64(block.number));

        if (mode == Mode.WrongSender) sender = Bech32.qor(address(0xBEEF));
        if (mode == Mode.WrongNote) text = string.concat(text, "x");
        string memory tail = mode == Mode.ExtraField ? ',"extra":1}' : "}";
        bytes memory reply = bytes(
            string.concat(
                '{"id":',
                NativeReceipt.decimal(count),
                ',"sender":"',
                sender,
                '","note":"',
                text,
                '","height":',
                NativeReceipt.decimal(block.number),
                tail
            )
        );
        if (mode == Mode.RawReply) {
            assembly {
                return(add(reply, 32), mload(reply))
            }
        }
        return reply;
    }

    function _noteOf(bytes calldata payload) private pure returns (string memory) {
        bytes memory prefix = '{"record":{"note":"';
        require(payload.length >= prefix.length + 3, "Error parsing into type qday_receipts::ExecuteMsg");
        for (uint256 i = 0; i < prefix.length; i++) {
            require(payload[i] == prefix[i], "Error parsing into type qday_receipts::ExecuteMsg");
        }
        return string(payload[prefix.length:payload.length - 3]);
    }
}
