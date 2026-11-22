// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {PqTestBase} from "haven-pq-kit-test/PqTestBase.sol";
import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {HavenLedger} from "../src/HavenLedger.sol";
import {NativeReceipt} from "../src/NativeReceipt.sol";

contract VectorsTest is PqTestBase {
    address internal constant LEDGER = 0x3333333333333333333333333333333333333333;
    address internal constant PAYER = 0x1111111111111111111111111111111111111111;
    address internal constant PAYEE = 0x2222222222222222222222222222222222222222;
    address internal constant TOKEN = 0x97143B771D34ddb9130b807b135Ae675A5a963CA;
    string internal constant RECEIPTS = "qor1xjayq5ev55tkzpml9klxwyshr7gdrha0nurha9jhm0f0gdckksgs3gltw8";
    uint256 internal constant AMOUNT = 100_000;
    string internal constant MEMO = "invoice 1";
    uint256 internal constant NONCE = 0;
    uint256 internal constant DEADLINE = 1_700_003_600;

    bytes32 internal constant ARGS = 0x5c0abb9c891d31397c12868300827dc80119bbeef5e35421f16633c1ea33cd77;
    bytes32 internal constant COMMITMENT = 0x3a828fa2d2b949686b1ccb8fe942eb93870d0a6c48ac78524d8a70412563544b;
    string internal constant NOTE =
        "haven-ledger v1 n=0 c=0x3a828fa2d2b949686b1ccb8fe942eb93870d0a6c48ac78524d8a70412563544b m=invoice 1";

    function test_vectorsMatchTheLedger() public {
        vm.chainId(9800);
        _register(PAYER);
        deployCodeTo(
            "HavenLedger.sol:HavenLedger",
            abi.encode(PAYER, PAYEE, TOKEN, RECEIPTS),
            LEDGER
        );
        HavenLedger ledger = HavenLedger(LEDGER);
        bytes memory signature = new bytes(PqAuth.SIG_LEN);

        assertEq(ledger.argsHash(PAYEE, AMOUNT, MEMO), ARGS);
        assertEq(ledger.commitmentOf(ledger.PAY(), PAYEE, AMOUNT, NONCE, signature), COMMITMENT);
        assertEq(NativeReceipt.note(NONCE, COMMITMENT, MEMO), NOTE);
        assertEq(
            PqAuth.encodeMessage(9800, LEDGER, PAYER, ledger.PAY(), NONCE, DEADLINE, ARGS),
            hex"e75e64e2fe37c327a6196b667e791aa53e61a6f7df40e7ac0542d985cea36278000000000000000000000000000000000000000000000000000000000000264800000000000000000000000033333333333333333333333333333333333333330000000000000000000000001111111111111111111111111111111111111111ce4f2429734c4677d82d9d124f394bf747b4657eeebba8e1acd340ec5675e2480000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006553ff105c0abb9c891d31397c12868300827dc80119bbeef5e35421f16633c1ea33cd77"
        );
    }
}
