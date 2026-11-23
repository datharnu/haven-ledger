// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {HavenLedgerQor} from "../src/HavenLedgerQor.sol";
import {NativeReceipt} from "../src/NativeReceipt.sol";
import {FixtureQor} from "./FixtureQor.sol";

contract HavenLedgerQorFuzzTest is FixtureQor {
    function testFuzz_pay_anyWholeUqorAmountWritesOneReceiptAndPaysThePayeeExactly(uint256 uqor, uint8 memoLen)
        public
    {
        uqor = bound(uqor, 1, FUNDED / UQOR);
        uint256 amount = uqor * UQOR;
        memoLen = uint8(bound(memoLen, 0, 30));
        string memory memo = _memo(memoLen);
        uint256 deadline = _deadline();
        ledger.pay(amount, memo, deadline, _paySig(amount, memo, deadline));
        assertEq(payee.balance, amount);
        assertEq(address(ledger).balance, FUNDED - amount);
        assertEq(bridge.count(), 1);
        assertEq(bridge.receipt(1).sender, ledger.ledgerAccount());
        assertEq(
            bridge.receipt(1).note,
            ledger.noteOf(0, ledger.payout(0).commitment, amount, memo)
        );
        assertTrue(_contains(bytes(bridge.receipt(1).note), bytes(string.concat(" a=", NativeReceipt.decimal(uqor), "uqor"))));
    }

    function testFuzz_pay_anAmountThatIsNotWholeUqorIsRefused(uint256 amount) public {
        amount = bound(amount, 1, type(uint128).max);
        vm.assume(amount % UQOR != 0);
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(amount, "", deadline);
        vm.expectRevert(abi.encodeWithSelector(HavenLedgerQor.NotWholeUqor.selector, amount));
        ledger.pay(amount, "", deadline, sig);
        assertEq(bridge.count(), 0);
        assertEq(payee.balance, 0);
    }

    function testFuzz_pay_aNoteOverTheNativeLimitMovesNothing(uint8 extra) public {
        // With 1 uqor the note without a memo is 96 characters, " m=" adds 3, so 42 memo characters is 141.
        string memory memo = _memo(42 + uint256(extra) % 200);
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(UQOR, memo, deadline);
        vm.expectRevert();
        ledger.pay(UQOR, memo, deadline, sig);
        assertEq(bridge.count(), 0);
        assertEq(payee.balance, 0);
        assertEq(address(ledger).balance, FUNDED);
    }

    function testFuzz_pay_anyOtherSignatureIsRefused(bytes32 seed, address caller) public {
        bytes memory sig = new bytes(PqAuth.SIG_LEN);
        for (uint256 i = 0; i < 32; i++) {
            sig[i] = seed[i];
        }
        vm.prank(caller);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        ledger.pay(UQOR, "", _deadline(), sig);
        assertEq(bridge.count(), 0);
        assertEq(payee.balance, 0);
    }

    function _memo(uint256 len) private pure returns (string memory) {
        bytes memory m = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            m[i] = bytes1(uint8(97 + (i % 26)));
        }
        return string(m);
    }

    function _contains(bytes memory hay, bytes memory needle) private pure returns (bool) {
        if (needle.length > hay.length) return false;
        for (uint256 i = 0; i + needle.length <= hay.length; i++) {
            bool hit = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (hay[i + j] != needle[j]) {
                    hit = false;
                    break;
                }
            }
            if (hit) return true;
        }
        return false;
    }
}
