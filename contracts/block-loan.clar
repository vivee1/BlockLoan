;; BlockLoan: Peer-to-peer lending contract with collateral, repayments, and liquidation
;;
;; This contract enables peer-to-peer lending with the following features:
;; - Borrowers can create loan requests with collateral requirements
;; - Lenders can fund approved loans
;; - Borrowers make repayments over time
;; - Overdue loans can be liquidated by anyone
;; - All loan states and repayments are tracked on-chain
;;
;; Loan Status States:
;; 0 (STATUS_OPEN): Loan created, waiting for funding
;; 1 (STATUS_FUNDED): Loan funded by lender, active repayment period
;; 2 (STATUS_REPAID): Loan fully repaid by borrower
;; 3 (STATUS_LIQUIDATED): Loan overdue and liquidated

(define-data-var loan-counter uint u0)

(define-map loans
    {loan-id: uint}
    {borrower: principal,
     lender: principal,
     amount: uint,
     collateral: uint,
     collateral-token: principal,
     repayment: uint,
     deadline: uint,
     status: uint}) ;; 0: Open, 1: Funded, 2: Repaid, 3: Liquidated

(define-map repayments
    {loan-id: uint}
    {amount: uint,
     timestamp: uint})

(define-constant ERR_UNAUTHORIZED (err u100))
(define-constant ERR_INVALID_LOAN (err u101))
(define-constant ERR_LOAN_NOT_OPEN (err u102))
(define-constant ERR_COLLATERAL_LOW (err u103))
(define-constant ERR_ALREADY_FUNDED (err u104))
(define-constant ERR_ALREADY_REPAID (err u105))
(define-constant ERR_LOAN_NOT_FUNDED (err u106))
(define-constant ERR_LOAN_NOT_DUE (err u107))
(define-constant ERR_INSUFFICIENT_REPAYMENT (err u108))
(define-constant STATUS_OPEN u0)
(define-constant STATUS_FUNDED u1)
(define-constant STATUS_REPAID u2)
(define-constant STATUS_LIQUIDATED u3)

;; Events
;; Event simulation using print

;; Loan creation function
(define-public (create-loan (lender principal) (amount uint) (collateral uint) (collateral-token principal) (deadline uint))
    (let ((loan-id (var-get loan-counter)))
        (begin
            (map-set loans
                {loan-id: loan-id}
                {borrower: tx-sender,
                 lender: lender,
                 amount: amount,
                 collateral: collateral,
                 collateral-token: collateral-token,
                 repayment: u0,
                 deadline: deadline,
                 status: STATUS_OPEN})
            (var-set loan-counter (+ loan-id u1))
            (print {event: "loan-created", loan-id: loan-id, borrower: tx-sender, lender: lender, amount: amount, collateral: collateral, deadline: deadline})
            (ok loan-id)
        )
    )
);; Collateral deposit function (simulated, actual token transfer handled externally)
(define-public (deposit-collateral (loan-id uint) (collateral-amount uint))
    (let ((loan (map-get? loans {loan-id: loan-id})))
        (if (is-none loan)
            ERR_INVALID_LOAN
            (let ((loan-data (unwrap-panic loan)))
                (if (not (is-eq (get borrower loan-data) tx-sender))
                    ERR_UNAUTHORIZED
                    (if (not (is-eq (get status loan-data) STATUS_OPEN))
                        ERR_LOAN_NOT_OPEN
                        (if (< collateral-amount (get collateral loan-data))
                            ERR_COLLATERAL_LOW
                            (begin
                                ;; Simulate collateral deposit
                                (print {event: "collateral-deposited", loan-id: loan-id, borrower: tx-sender, amount: collateral-amount})
                                (ok true)
                            )
                        )
                    )
                )
            )
        )
    )
)

;; Fund a loan (lender provides the loan amount)
(define-public (fund-loan (loan-id uint))
    (let ((loan (map-get? loans {loan-id: loan-id})))
        (if (is-none loan)
            ERR_INVALID_LOAN
            (let ((loan-data (unwrap-panic loan)))
                (if (not (is-eq (get lender loan-data) tx-sender))
                    ERR_UNAUTHORIZED
                    (if (not (is-eq (get status loan-data) STATUS_OPEN))
                        ERR_ALREADY_FUNDED
                        (begin
                            (map-set loans
                                {loan-id: loan-id}
                                (merge loan-data {status: STATUS_FUNDED}))
                            (print {event: "loan-funded", loan-id: loan-id, lender: tx-sender})
                            (ok true)
                        )
                    )
                )
            )
        )
    )
)

;; Make repayment on a loan
(define-public (make-repayment (loan-id uint) (repayment-amount uint))
    (let ((loan (map-get? loans {loan-id: loan-id})))
        (if (is-none loan)
            ERR_INVALID_LOAN
            (let ((loan-data (unwrap-panic loan)))
                (if (not (is-eq (get borrower loan-data) tx-sender))
                    ERR_UNAUTHORIZED
                    (if (not (is-eq (get status loan-data) STATUS_FUNDED))
                        ERR_LOAN_NOT_OPEN
                        (let ((current-repayment (get repayment loan-data))
                              (total-repayment (+ current-repayment repayment-amount)))
                            (begin
                                (map-set loans
                                    {loan-id: loan-id}
                                    (merge loan-data {repayment: total-repayment}))
                                (map-set repayments
                                    {loan-id: loan-id}
                                    {amount: repayment-amount, timestamp: block-height})
                                (print {event: "repayment-made", loan-id: loan-id, borrower: tx-sender, amount: repayment-amount, total-repaid: total-repayment})
                                (ok total-repayment)
                            )
                        )
                    )
                )
            )
        )
    )
)

;; Complete loan repayment and mark as repaid
(define-public (complete-repayment (loan-id uint))
    (let ((loan (map-get? loans {loan-id: loan-id})))
        (if (is-none loan)
            ERR_INVALID_LOAN
            (let ((loan-data (unwrap-panic loan)))
                (if (not (is-eq (get borrower loan-data) tx-sender))
                    ERR_UNAUTHORIZED
                    (if (not (is-eq (get status loan-data) STATUS_FUNDED))
                        ERR_LOAN_NOT_FUNDED
                        (if (< (get repayment loan-data) (get amount loan-data))
                            ERR_INSUFFICIENT_REPAYMENT
                            (begin
                                (map-set loans
                                    {loan-id: loan-id}
                                    (merge loan-data {status: STATUS_REPAID}))
                                (print {event: "loan-completed", loan-id: loan-id, borrower: tx-sender})
                                (ok true)
                            )
                        )
                    )
                )
            )
        )
    )
)

;; Liquidate overdue loan (anyone can call if deadline passed)
(define-public (liquidate-loan (loan-id uint))
    (let ((loan (map-get? loans {loan-id: loan-id})))
        (if (is-none loan)
            ERR_INVALID_LOAN
            (let ((loan-data (unwrap-panic loan)))
                (if (not (is-eq (get status loan-data) STATUS_FUNDED))
                    ERR_LOAN_NOT_FUNDED
                    (if (<= (get deadline loan-data) block-height)
                        (begin
                            (map-set loans
                                {loan-id: loan-id}
                                (merge loan-data {status: STATUS_LIQUIDATED}))
                            (print {event: "loan-liquidated", loan-id: loan-id, liquidator: tx-sender})
                            (ok true)
                        )
                        ERR_LOAN_NOT_DUE
                    )
                )
            )
        )
    )
)

;; Read-only function to get loan details
(define-read-only (get-loan (loan-id uint))
    (map-get? loans {loan-id: loan-id})
)

;; Read-only function to get repayment details
(define-read-only (get-repayment (loan-id uint))
    (map-get? repayments {loan-id: loan-id})
)

;; Read-only function to check if loan is overdue
(define-read-only (is-loan-overdue (loan-id uint))
    (let ((loan (map-get? loans {loan-id: loan-id})))
        (if (is-some loan)
            (let ((loan-data (unwrap-panic loan)))
                (and (is-eq (get status loan-data) STATUS_FUNDED)
                     (> block-height (get deadline loan-data)))
            )
            false
        )
    )
)

;; Read-only function to get the current loan counter
(define-read-only (get-loan-counter)
    (var-get loan-counter)
)

;; Read-only function to calculate loan progress (repaid/total)
(define-read-only (get-loan-progress (loan-id uint))
    (let ((loan (map-get? loans {loan-id: loan-id})))
        (if (is-some loan)
            (let ((loan-data (unwrap-panic loan)))
                (if (> (get amount loan-data) u0)
                    (/ (* (get repayment loan-data) u100) (get amount loan-data))
                    u0
                )
            )
            u0
        )
    )
)

;; Read-only function to check loan health (time remaining vs repayment progress)
(define-read-only (get-loan-health (loan-id uint))
    (let ((loan (map-get? loans {loan-id: loan-id})))
        (if (is-some loan)
            (let ((loan-data (unwrap-panic loan))
                  (progress (get-loan-progress loan-id)))
                (if (and (is-eq (get status loan-data) STATUS_FUNDED)
                         (> (get deadline loan-data) block-height))
                    (let ((time-remaining (- (get deadline loan-data) block-height))
                          (total-time (- (get deadline loan-data) u0))) ;; Simplified time calculation
                        (if (>= progress (/ (* time-remaining u100) total-time))
                            {status: "healthy", progress: progress}
                            {status: "at-risk", progress: progress}
                        )
                    )
                    {status: "inactive", progress: progress}
                )
            )
            {status: "not-found", progress: u0}
        )
    )
)

;; Administrative function to get contract statistics (could be restricted in production)
(define-read-only (get-contract-stats)
    {
        total-loans: (var-get loan-counter),
        block-height: block-height
    }
)
;; block-loan
;; <add a description here>

;; constants
;;

;; data maps and vars
;;

;; private functions
;;

;; public functions
;;
