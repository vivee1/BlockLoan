
import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v0.14.0/index.ts';
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

// Test constants
const CONTRACT_NAME = "block-loan";
const ERR_UNAUTHORIZED = 100;
const ERR_INVALID_LOAN = 101;
const ERR_LOAN_NOT_OPEN = 102;
const ERR_COLLATERAL_LOW = 103;
const ERR_ALREADY_FUNDED = 104;
const ERR_ALREADY_REPAID = 105;
const ERR_LOAN_NOT_FUNDED = 106;
const ERR_LOAN_NOT_DUE = 107;
const ERR_INSUFFICIENT_REPAYMENT = 108;

// Status constants
const STATUS_OPEN = 0;
const STATUS_FUNDED = 1;
const STATUS_REPAID = 2;
const STATUS_LIQUIDATED = 3;

Clarinet.test({
    name: "Test loan creation - successful loan request",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        
        let block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000), // loan amount
                    types.uint(1200), // collateral required
                    types.principal(deployer.address), // collateral token
                    types.uint(100)   // deadline (block height)
                ],
                borrower.address
            ),
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(0); // First loan ID
        
        // Verify loan counter incremented
        let loanCounter = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-loan-counter",
            [],
            deployer.address
        );
        loanCounter.result.expectUint(1);
    },
});

Clarinet.test({
    name: "Test loan creation - multiple loans increment counter",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower1 = accounts.get("wallet_1")!;
        const borrower2 = accounts.get("wallet_2")!;
        const lender = accounts.get("wallet_3")!;
        
        let block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(500),
                    types.uint(600),
                    types.principal(deployer.address),
                    types.uint(50)
                ],
                borrower1.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(2000),
                    types.uint(2500),
                    types.principal(deployer.address),
                    types.uint(75)
                ],
                borrower2.address
            ),
        ]);
        
        assertEquals(block.receipts.length, 2);
        block.receipts[0].result.expectOk().expectUint(0); // First loan
        block.receipts[1].result.expectOk().expectUint(1); // Second loan
        
        // Verify final loan counter
        let loanCounter = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-loan-counter",
            [],
            deployer.address
        );
        loanCounter.result.expectUint(2);
    },
});

Clarinet.test({
    name: "Test get-loan function - retrieve loan details",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        
        // Create a loan first
        let block = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1500),
                    types.uint(1800),
                    types.principal(deployer.address),
                    types.uint(120)
                ],
                borrower.address
            ),
        ]);
        
        assertEquals(block.receipts.length, 1);
        
        // Retrieve loan details
        let loanDetails = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-loan",
            [types.uint(0)],
            deployer.address
        );
        
        let loan = loanDetails.result.expectSome().expectTuple() as any;
        assertEquals(loan["borrower"], borrower.address);
        assertEquals(loan["lender"], lender.address);
        assertEquals(loan["amount"], "u1500");
        assertEquals(loan["collateral"], "u1800");
        assertEquals(loan["status"], "u0");
    },
});

Clarinet.test({
    name: "Test get-loan function - non-existent loan returns none",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        
        // Try to get a loan that doesn't exist
        let loanDetails = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-loan",
            [types.uint(999)],
            deployer.address
        );
        
        loanDetails.result.expectNone();
    },
});

Clarinet.test({
    name: "Test contract stats - initial state",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        
        let stats = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-contract-stats",
            [],
            deployer.address
        );
        
        let statsData = stats.result.expectTuple() as any;
        assertEquals(statsData["total-loans"], "u0");
        // Block height should be greater than 0
        const blockHeight = parseInt(statsData["block-height"].replace('u', ''));
        assertEquals(blockHeight > 0, true);
    },
});

// ========== COMMIT 2: COLLATERAL DEPOSIT AND LOAN FUNDING TESTS ==========

Clarinet.test({
    name: "Test collateral deposit - successful deposit",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        
        // First create a loan
        let createBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000),
                    types.uint(1200), // collateral required
                    types.principal(deployer.address),
                    types.uint(100)
                ],
                borrower.address
            ),
        ]);
        
        assertEquals(createBlock.receipts.length, 1);
        createBlock.receipts[0].result.expectOk();
        
        // Now deposit collateral
        let depositBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "deposit-collateral",
                [
                    types.uint(0), // loan ID
                    types.uint(1200) // deposit exact collateral amount
                ],
                borrower.address
            ),
        ]);
        
        assertEquals(depositBlock.receipts.length, 1);
        depositBlock.receipts[0].result.expectOk();
    },
});

Clarinet.test({
    name: "Test collateral deposit - insufficient collateral fails",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        
        // Create a loan
        let createBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000),
                    types.uint(1500), // collateral required
                    types.principal(deployer.address),
                    types.uint(100)
                ],
                borrower.address
            ),
        ]);
        
        createBlock.receipts[0].result.expectOk();
        
        // Try to deposit insufficient collateral
        let depositBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "deposit-collateral",
                [
                    types.uint(0), // loan ID
                    types.uint(1000) // insufficient amount
                ],
                borrower.address
            ),
        ]);
        
        assertEquals(depositBlock.receipts.length, 1);
        depositBlock.receipts[0].result.expectErr().expectUint(ERR_COLLATERAL_LOW);
    },
});

Clarinet.test({
    name: "Test collateral deposit - unauthorized user fails",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        const unauthorized = accounts.get("wallet_3")!;
        
        // Create a loan
        let createBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000),
                    types.uint(1200),
                    types.principal(deployer.address),
                    types.uint(100)
                ],
                borrower.address
            ),
        ]);
        
        createBlock.receipts[0].result.expectOk();
        
        // Try to deposit collateral as unauthorized user
        let depositBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "deposit-collateral",
                [
                    types.uint(0),
                    types.uint(1200)
                ],
                unauthorized.address // Wrong user
            ),
        ]);
        
        assertEquals(depositBlock.receipts.length, 1);
        depositBlock.receipts[0].result.expectErr().expectUint(ERR_UNAUTHORIZED);
    },
});

Clarinet.test({
    name: "Test loan funding - successful funding by lender",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        
        // Create loan
        let createBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000),
                    types.uint(1200),
                    types.principal(deployer.address),
                    types.uint(100)
                ],
                borrower.address
            ),
        ]);
        
        createBlock.receipts[0].result.expectOk();
        
        // Fund the loan
        let fundBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "fund-loan",
                [types.uint(0)], // loan ID
                lender.address
            ),
        ]);
        
        assertEquals(fundBlock.receipts.length, 1);
        fundBlock.receipts[0].result.expectOk();
        
        // Verify loan status changed to FUNDED
        let loanDetails = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-loan",
            [types.uint(0)],
            deployer.address
        );
        
        let loan = loanDetails.result.expectSome().expectTuple() as any;
        assertEquals(loan["status"], "u1"); // STATUS_FUNDED
    },
});

Clarinet.test({
    name: "Test loan funding - unauthorized user cannot fund",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        const unauthorized = accounts.get("wallet_3")!;
        
        // Create loan
        let createBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000),
                    types.uint(1200),
                    types.principal(deployer.address),
                    types.uint(100)
                ],
                borrower.address
            ),
        ]);
        
        createBlock.receipts[0].result.expectOk();
        
        // Try to fund as unauthorized user
        let fundBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "fund-loan",
                [types.uint(0)],
                unauthorized.address // Wrong user
            ),
        ]);
        
        assertEquals(fundBlock.receipts.length, 1);
        fundBlock.receipts[0].result.expectErr().expectUint(ERR_UNAUTHORIZED);
    },
});

Clarinet.test({
    name: "Test loan funding - cannot fund already funded loan",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        
        // Create and fund loan
        let initialBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000),
                    types.uint(1200),
                    types.principal(deployer.address),
                    types.uint(100)
                ],
                borrower.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "fund-loan",
                [types.uint(0)],
                lender.address
            ),
        ]);
        
        assertEquals(initialBlock.receipts.length, 2);
        initialBlock.receipts[0].result.expectOk();
        initialBlock.receipts[1].result.expectOk();
        
        // Try to fund again
        let refundBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "fund-loan",
                [types.uint(0)],
                lender.address
            ),
        ]);
        
        assertEquals(refundBlock.receipts.length, 1);
        refundBlock.receipts[0].result.expectErr().expectUint(ERR_ALREADY_FUNDED);
    },
});

Clarinet.test({
    name: "Test loan funding - invalid loan ID fails",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const lender = accounts.get("wallet_2")!;
        
        // Try to fund non-existent loan
        let fundBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "fund-loan",
                [types.uint(999)], // Non-existent loan
                lender.address
            ),
        ]);
        
        assertEquals(fundBlock.receipts.length, 1);
        fundBlock.receipts[0].result.expectErr().expectUint(ERR_INVALID_LOAN);
    },
});

// ========== COMMIT 3: REPAYMENT AND LOAN COMPLETION TESTS ==========

Clarinet.test({
    name: "Test make repayment - successful partial repayment",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        
        // Setup: Create and fund loan
        let setupBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000), // loan amount
                    types.uint(1200),
                    types.principal(deployer.address),
                    types.uint(100)
                ],
                borrower.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "fund-loan",
                [types.uint(0)],
                lender.address
            ),
        ]);
        
        assertEquals(setupBlock.receipts.length, 2);
        setupBlock.receipts[0].result.expectOk();
        setupBlock.receipts[1].result.expectOk();
        
        // Make partial repayment
        let repaymentBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "make-repayment",
                [
                    types.uint(0), // loan ID
                    types.uint(300) // partial payment
                ],
                borrower.address
            ),
        ]);
        
        assertEquals(repaymentBlock.receipts.length, 1);
        repaymentBlock.receipts[0].result.expectOk().expectUint(300); // Returns total repaid
        
        // Verify loan repayment amount updated
        let loanDetails = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-loan",
            [types.uint(0)],
            deployer.address
        );
        
        let loan = loanDetails.result.expectSome().expectTuple() as any;
        assertEquals(loan["repayment"], "u300");
    },
});

Clarinet.test({
    name: "Test make repayment - multiple repayments accumulate",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        
        // Setup: Create and fund loan
        let setupBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(2000), // loan amount
                    types.uint(2400),
                    types.principal(deployer.address),
                    types.uint(100)
                ],
                borrower.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "fund-loan",
                [types.uint(0)],
                lender.address
            ),
        ]);
        
        setupBlock.receipts[0].result.expectOk();
        setupBlock.receipts[1].result.expectOk();
        
        // Make multiple repayments
        let repaymentBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "make-repayment",
                [types.uint(0), types.uint(500)], // First payment
                borrower.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "make-repayment",
                [types.uint(0), types.uint(750)], // Second payment
                borrower.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "make-repayment",
                [types.uint(0), types.uint(200)], // Third payment
                borrower.address
            ),
        ]);
        
        assertEquals(repaymentBlock.receipts.length, 3);
        repaymentBlock.receipts[0].result.expectOk().expectUint(500);  // Total: 500
        repaymentBlock.receipts[1].result.expectOk().expectUint(1250); // Total: 1250
        repaymentBlock.receipts[2].result.expectOk().expectUint(1450); // Total: 1450
        
        // Verify final repayment amount
        let loanDetails = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-loan",
            [types.uint(0)],
            deployer.address
        );
        
        let loan = loanDetails.result.expectSome().expectTuple() as any;
        assertEquals(loan["repayment"], "u1450");
    },
});

Clarinet.test({
    name: "Test make repayment - unauthorized user cannot repay",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        const unauthorized = accounts.get("wallet_3")!;
        
        // Setup: Create and fund loan
        let setupBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000),
                    types.uint(1200),
                    types.principal(deployer.address),
                    types.uint(100)
                ],
                borrower.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "fund-loan",
                [types.uint(0)],
                lender.address
            ),
        ]);
        
        setupBlock.receipts[0].result.expectOk();
        setupBlock.receipts[1].result.expectOk();
        
        // Try to make repayment as unauthorized user
        let repaymentBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "make-repayment",
                [types.uint(0), types.uint(500)],
                unauthorized.address // Wrong user
            ),
        ]);
        
        assertEquals(repaymentBlock.receipts.length, 1);
        repaymentBlock.receipts[0].result.expectErr().expectUint(ERR_UNAUTHORIZED);
    },
});

Clarinet.test({
    name: "Test make repayment - cannot repay unfunded loan",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        
        // Create loan but don't fund it
        let createBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000),
                    types.uint(1200),
                    types.principal(deployer.address),
                    types.uint(100)
                ],
                borrower.address
            ),
        ]);
        
        createBlock.receipts[0].result.expectOk();
        
        // Try to make repayment on unfunded loan
        let repaymentBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "make-repayment",
                [types.uint(0), types.uint(500)],
                borrower.address
            ),
        ]);
        
        assertEquals(repaymentBlock.receipts.length, 1);
        repaymentBlock.receipts[0].result.expectErr().expectUint(ERR_LOAN_NOT_OPEN);
    },
});

Clarinet.test({
    name: "Test complete repayment - successful completion",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        
        // Setup: Create, fund, and fully repay loan
        let setupBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000), // loan amount
                    types.uint(1200),
                    types.principal(deployer.address),
                    types.uint(100)
                ],
                borrower.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "fund-loan",
                [types.uint(0)],
                lender.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "make-repayment",
                [types.uint(0), types.uint(1000)], // Full repayment
                borrower.address
            ),
        ]);
        
        assertEquals(setupBlock.receipts.length, 3);
        setupBlock.receipts[0].result.expectOk();
        setupBlock.receipts[1].result.expectOk();
        setupBlock.receipts[2].result.expectOk();
        
        // Complete the loan
        let completionBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "complete-repayment",
                [types.uint(0)],
                borrower.address
            ),
        ]);
        
        assertEquals(completionBlock.receipts.length, 1);
        completionBlock.receipts[0].result.expectOk();
        
        // Verify loan status is now REPAID
        let loanDetails = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-loan",
            [types.uint(0)],
            deployer.address
        );
        
        let loan = loanDetails.result.expectSome().expectTuple() as any;
        assertEquals(loan["status"], "u2"); // STATUS_REPAID
    },
});

Clarinet.test({
    name: "Test complete repayment - insufficient repayment fails",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        
        // Setup: Create, fund, and partially repay loan
        let setupBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000), // loan amount
                    types.uint(1200),
                    types.principal(deployer.address),
                    types.uint(100)
                ],
                borrower.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "fund-loan",
                [types.uint(0)],
                lender.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "make-repayment",
                [types.uint(0), types.uint(800)], // Partial repayment
                borrower.address
            ),
        ]);
        
        setupBlock.receipts[0].result.expectOk();
        setupBlock.receipts[1].result.expectOk();
        setupBlock.receipts[2].result.expectOk();
        
        // Try to complete with insufficient repayment
        let completionBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "complete-repayment",
                [types.uint(0)],
                borrower.address
            ),
        ]);
        
        assertEquals(completionBlock.receipts.length, 1);
        completionBlock.receipts[0].result.expectErr().expectUint(ERR_INSUFFICIENT_REPAYMENT);
    },
});

Clarinet.test({
    name: "Test get repayment details - verify repayment tracking",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        
        // Setup: Create, fund, and make repayment
        let setupBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000),
                    types.uint(1200),
                    types.principal(deployer.address),
                    types.uint(100)
                ],
                borrower.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "fund-loan",
                [types.uint(0)],
                lender.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "make-repayment",
                [types.uint(0), types.uint(600)],
                borrower.address
            ),
        ]);
        
        setupBlock.receipts[0].result.expectOk();
        setupBlock.receipts[1].result.expectOk();
        setupBlock.receipts[2].result.expectOk();
        
        // Get repayment details
        let repaymentDetails = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-repayment",
            [types.uint(0)],
            deployer.address
        );
        
        let repayment = repaymentDetails.result.expectSome().expectTuple() as any;
        assertEquals(repayment["amount"], "u600");
        // Timestamp should be a positive block height
        const timestamp = parseInt(repayment["timestamp"].replace('u', ''));
        assertEquals(timestamp > 0, true);
    },
});

// ========== COMMIT 4: LIQUIDATION, HEALTH MONITORING AND EDGE CASE TESTS ==========

Clarinet.test({
    name: "Test liquidate loan - successful liquidation of overdue loan",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        const liquidator = accounts.get("wallet_3")!;
        
        // Create and fund loan with short deadline
        let setupBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000),
                    types.uint(1200),
                    types.principal(deployer.address),
                    types.uint(5) // Very short deadline (5 blocks)
                ],
                borrower.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "fund-loan",
                [types.uint(0)],
                lender.address
            ),
        ]);
        
        setupBlock.receipts[0].result.expectOk();
        setupBlock.receipts[1].result.expectOk();
        
        // Mine blocks to pass deadline
        chain.mineEmptyBlockUntil(10); // Mine until block 10, past deadline of 5
        
        // Liquidate the loan
        let liquidationBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "liquidate-loan",
                [types.uint(0)],
                liquidator.address
            ),
        ]);
        
        assertEquals(liquidationBlock.receipts.length, 1);
        liquidationBlock.receipts[0].result.expectOk();
        
        // Verify loan status is LIQUIDATED
        let loanDetails = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-loan",
            [types.uint(0)],
            deployer.address
        );
        
        let loan = loanDetails.result.expectSome().expectTuple() as any;
        assertEquals(loan["status"], "u3"); // STATUS_LIQUIDATED
    },
});

Clarinet.test({
    name: "Test liquidate loan - cannot liquidate loan before deadline",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        const liquidator = accounts.get("wallet_3")!;
        
        // Create and fund loan with future deadline
        let setupBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000),
                    types.uint(1200),
                    types.principal(deployer.address),
                    types.uint(100) // Deadline far in future
                ],
                borrower.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "fund-loan",
                [types.uint(0)],
                lender.address
            ),
        ]);
        
        setupBlock.receipts[0].result.expectOk();
        setupBlock.receipts[1].result.expectOk();
        
        // Try to liquidate before deadline
        let liquidationBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "liquidate-loan",
                [types.uint(0)],
                liquidator.address
            ),
        ]);
        
        assertEquals(liquidationBlock.receipts.length, 1);
        liquidationBlock.receipts[0].result.expectErr().expectUint(ERR_LOAN_NOT_DUE);
    },
});

Clarinet.test({
    name: "Test liquidate loan - cannot liquidate unfunded loan",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        const liquidator = accounts.get("wallet_3")!;
        
        // Create loan but don't fund it
        let createBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000),
                    types.uint(1200),
                    types.principal(deployer.address),
                    types.uint(5)
                ],
                borrower.address
            ),
        ]);
        
        createBlock.receipts[0].result.expectOk();
        
        // Mine blocks to pass deadline
        chain.mineEmptyBlockUntil(10);
        
        // Try to liquidate unfunded loan
        let liquidationBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "liquidate-loan",
                [types.uint(0)],
                liquidator.address
            ),
        ]);
        
        assertEquals(liquidationBlock.receipts.length, 1);
        liquidationBlock.receipts[0].result.expectErr().expectUint(ERR_LOAN_NOT_FUNDED);
    },
});

Clarinet.test({
    name: "Test is-loan-overdue - correctly identifies overdue status",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        
        // Create and fund loan with short deadline
        let setupBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000),
                    types.uint(1200),
                    types.principal(deployer.address),
                    types.uint(8) // Deadline at block 8
                ],
                borrower.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "fund-loan",
                [types.uint(0)],
                lender.address
            ),
        ]);
        
        setupBlock.receipts[0].result.expectOk();
        setupBlock.receipts[1].result.expectOk();
        
        // Check not overdue initially
        let overdueCheck1 = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "is-loan-overdue",
            [types.uint(0)],
            deployer.address
        );
        assertEquals(overdueCheck1.result.expectBool(false), false);
        
        // Mine past deadline
        chain.mineEmptyBlockUntil(12);
        
        // Check now overdue
        let overdueCheck2 = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "is-loan-overdue",
            [types.uint(0)],
            deployer.address
        );
        assertEquals(overdueCheck2.result.expectBool(true), true);
    },
});

Clarinet.test({
    name: "Test get-loan-progress - calculates repayment percentage",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        
        // Setup loan
        let setupBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000), // Total loan amount
                    types.uint(1200),
                    types.principal(deployer.address),
                    types.uint(100)
                ],
                borrower.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "fund-loan",
                [types.uint(0)],
                lender.address
            ),
        ]);
        
        setupBlock.receipts[0].result.expectOk();
        setupBlock.receipts[1].result.expectOk();
        
        // Check progress at 0% (no repayments)
        let progress1 = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-loan-progress",
            [types.uint(0)],
            deployer.address
        );
        progress1.result.expectUint(0); // 0%
        
        // Make 50% repayment
        let repaymentBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "make-repayment",
                [types.uint(0), types.uint(500)], // 50% of 1000
                borrower.address
            ),
        ]);
        repaymentBlock.receipts[0].result.expectOk();
        
        // Check progress at 50%
        let progress2 = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-loan-progress",
            [types.uint(0)],
            deployer.address
        );
        progress2.result.expectUint(50); // 50%
        
        // Make additional 30% repayment
        let repaymentBlock2 = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "make-repayment",
                [types.uint(0), types.uint(300)], // 30% more
                borrower.address
            ),
        ]);
        repaymentBlock2.receipts[0].result.expectOk();
        
        // Check progress at 80%
        let progress3 = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-loan-progress",
            [types.uint(0)],
            deployer.address
        );
        progress3.result.expectUint(80); // 80%
    },
});

Clarinet.test({
    name: "Test get-loan-health - assesses loan health status",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        
        // Setup loan
        let setupBlock = chain.mineBlock([
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(1000),
                    types.uint(1200),
                    types.principal(deployer.address),
                    types.uint(50) // Deadline at block 50
                ],
                borrower.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "fund-loan",
                [types.uint(0)],
                lender.address
            ),
        ]);
        
        setupBlock.receipts[0].result.expectOk();
        setupBlock.receipts[1].result.expectOk();
        
        // Check health of active funded loan
        let health1 = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-loan-health",
            [types.uint(0)],
            deployer.address
        );
        
        let healthData1 = health1.result.expectTuple() as any;
        // Should have some status (healthy/at-risk/inactive)
        assertEquals(healthData1["progress"], "u0"); // 0% progress initially
    },
});

Clarinet.test({
    name: "Test edge case - complete workflow integration",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower = accounts.get("wallet_1")!;
        const lender = accounts.get("wallet_2")!;
        
        // Complete loan lifecycle test
        let fullWorkflow = chain.mineBlock([
            // 1. Create loan
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender.address),
                    types.uint(2000),
                    types.uint(2500),
                    types.principal(deployer.address),
                    types.uint(200)
                ],
                borrower.address
            ),
            // 2. Deposit collateral
            Tx.contractCall(
                CONTRACT_NAME,
                "deposit-collateral",
                [types.uint(0), types.uint(2500)],
                borrower.address
            ),
            // 3. Fund loan
            Tx.contractCall(
                CONTRACT_NAME,
                "fund-loan",
                [types.uint(0)],
                lender.address
            ),
            // 4. Make partial repayment
            Tx.contractCall(
                CONTRACT_NAME,
                "make-repayment",
                [types.uint(0), types.uint(1000)],
                borrower.address
            ),
            // 5. Make final repayment
            Tx.contractCall(
                CONTRACT_NAME,
                "make-repayment",
                [types.uint(0), types.uint(1000)],
                borrower.address
            ),
            // 6. Complete loan
            Tx.contractCall(
                CONTRACT_NAME,
                "complete-repayment",
                [types.uint(0)],
                borrower.address
            ),
        ]);
        
        assertEquals(fullWorkflow.receipts.length, 6);
        
        // Verify all operations succeeded
        fullWorkflow.receipts.forEach((receipt, index) => {
            receipt.result.expectOk();
        });
        
        // Verify final loan state
        let finalLoan = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-loan",
            [types.uint(0)],
            deployer.address
        );
        
        let loan = finalLoan.result.expectSome().expectTuple() as any;
        assertEquals(loan["status"], "u2"); // STATUS_REPAID
        assertEquals(loan["repayment"], "u2000"); // Full amount repaid
    },
});

Clarinet.test({
    name: "Test edge case - multiple loans with different states",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const borrower1 = accounts.get("wallet_1")!;
        const borrower2 = accounts.get("wallet_2")!;
        const borrower3 = accounts.get("wallet_3")!;
        const lender1 = accounts.get("wallet_4")!;
        const lender2 = accounts.get("wallet_5")!;
        const lender3 = accounts.get("wallet_6")!;
        
        // Create multiple loans in different states
        let multiLoanBlock = chain.mineBlock([
            // Loan 0: Create only (OPEN)
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender1.address),
                    types.uint(1000), types.uint(1200),
                    types.principal(deployer.address), types.uint(100)
                ],
                borrower1.address
            ),
            // Loan 1: Create and fund (FUNDED)
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender2.address),
                    types.uint(2000), types.uint(2400),
                    types.principal(deployer.address), types.uint(150)
                ],
                borrower2.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "fund-loan",
                [types.uint(1)],
                lender2.address
            ),
            // Loan 2: Create, fund, and complete (REPAID)
            Tx.contractCall(
                CONTRACT_NAME,
                "create-loan",
                [
                    types.principal(lender3.address),
                    types.uint(500), types.uint(600),
                    types.principal(deployer.address), types.uint(80)
                ],
                borrower3.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "fund-loan",
                [types.uint(2)],
                lender3.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "make-repayment",
                [types.uint(2), types.uint(500)],
                borrower3.address
            ),
            Tx.contractCall(
                CONTRACT_NAME,
                "complete-repayment",
                [types.uint(2)],
                borrower3.address
            ),
        ]);
        
        assertEquals(multiLoanBlock.receipts.length, 7);
        
        // Verify loan counter
        let counter = chain.callReadOnlyFn(
            CONTRACT_NAME,
            "get-loan-counter",
            [],
            deployer.address
        );
        counter.result.expectUint(3);
        
        // Verify different loan states
        let loan0 = chain.callReadOnlyFn(CONTRACT_NAME, "get-loan", [types.uint(0)], deployer.address);
        let loan1 = chain.callReadOnlyFn(CONTRACT_NAME, "get-loan", [types.uint(1)], deployer.address);
        let loan2 = chain.callReadOnlyFn(CONTRACT_NAME, "get-loan", [types.uint(2)], deployer.address);
        
        let l0 = loan0.result.expectSome().expectTuple() as any;
        let l1 = loan1.result.expectSome().expectTuple() as any;
        let l2 = loan2.result.expectSome().expectTuple() as any;
        
        assertEquals(l0["status"], "u0"); // OPEN
        assertEquals(l1["status"], "u1"); // FUNDED
        assertEquals(l2["status"], "u2"); // REPAID
    },
});
