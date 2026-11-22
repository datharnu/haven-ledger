// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {HavenLedger} from "../src/HavenLedger.sol";
import {NativeReceipt} from "../src/NativeReceipt.sol";
import {Fixture} from "./Fixture.sol";

contract HavenLedgerFuzzTest is Fixture {
    function testFuzz_pay_anyFundedAmountWritesOneReceiptAndPaysThePayee(uint256 amount, uint8 memoLen) public {
        amount = bound(amount, 1, FUNDED);
        memoLen = uint8(bound(memoLen, 0, 49));
        string memory memo = _memo(memoLen);
        uint256 deadline = _deadline();
        ledger.pay(amount, memo, deadline, _paySig(amount, memo, deadline));
        assertEq(token.balanceOf(payee), amount);
        assertEq(bridge.count(), 1);
        assertEq(bridge.receipt(1).sender, ledger.ledgerAccount());
    }

    function testFuzz_pay_aNoteOverTheNativeLimitMovesNothing(uint8 extra) public {
        // The note without a memo is 88 characters, " m=" adds 3, so 50 memo characters is 141.
        string memory memo = _memo(50 + uint256(extra) % 200);
        uint256 deadline = _deadline();
        bytes memory sig = _paySig(1, memo, deadline);
        vm.expectRevert();
        ledger.pay(1, memo, deadline, sig);
        assertEq(bridge.count(), 0);
        assertEq(token.balanceOf(payee), 0);
    }

    function testFuzz_pay_anyOtherSignatureIsRefused(bytes32 seed, address caller) public {
        bytes memory sig = new bytes(PqAuth.SIG_LEN);
        for (uint256 i = 0; i < 32; i++) {
            sig[i] = seed[i];
        }
        vm.prank(caller);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        ledger.pay(100, "", _deadline(), sig);
        assertEq(bridge.count(), 0);
    }

    function testFuzz_reply_rejectsAnyChangedByte(uint16 at, uint8 flip) public view {
        vm.assume(flip != 0);
        string memory account = ledger.ledgerAccount();
        string memory text = "haven-ledger v1 n=0 c=0x00";
        bytes memory good =
            bytes(string.concat('{"id":4,"sender":"', account, '","note":"', text, '","height":10518530}'));
        uint256 i = uint256(at) % good.length;
        bytes memory bad = bytes.concat(good);
        bad[i] = bytes1(uint8(bad[i]) ^ flip);
        (bool ok,) = address(this).staticcall(abi.encodeCall(this.check, (bad, account, text)));
        if (ok) {
            // Only a digit swapped for another digit inside a number may still parse.
            assertTrue(_isDigit(good[i]) && _isDigit(bad[i]));
        }
    }

    function check(bytes memory reply, string memory account, string memory text) external pure {
        NativeReceipt.check(reply, account, text);
    }

    function _isDigit(bytes1 b) private pure returns (bool) {
        return b >= "0" && b <= "9";
    }

    function _memo(uint256 len) private pure returns (string memory) {
        bytes memory m = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            m[i] = bytes1(uint8(97 + (i % 26)));
        }
        return string(m);
    }
}
