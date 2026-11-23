// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {HavenLedgerQor} from "../../src/HavenLedgerQor.sol";

/// @notice A payee whose code refuses every QOR transfer.
contract RejectingPayee {
    receive() external payable {
        revert("no QOR here");
    }
}

/// @notice A payee that tries to pay itself again from inside the transfer.
/// With `bubble` it reverts with whatever the inner call returned; without it, it swallows the error.
contract ReentrantPayee {
    HavenLedgerQor public ledger;
    bool public bubble;
    uint256 public amount;
    uint256 public deadline;
    bytes public signature;
    bytes public reentryError;
    bool public reentered;
    uint256 public received;

    function arm(HavenLedgerQor ledger_, bool bubble_, uint256 amount_, uint256 deadline_, bytes calldata signature_)
        external
    {
        ledger = ledger_;
        bubble = bubble_;
        amount = amount_;
        deadline = deadline_;
        signature = signature_;
    }

    receive() external payable {
        received += msg.value;
        if (reentered || address(ledger) == address(0)) return;
        reentered = true;
        try ledger.pay(amount, "", deadline, signature) {}
        catch (bytes memory reason) {
            reentryError = reason;
            if (bubble) {
                assembly {
                    revert(add(reason, 32), mload(reason))
                }
            }
        }
    }
}
