;; BlockLoan: Peer-to-peer lending contract with collateral, repayments, and liquidation

(define-data-var loan-counter uint u0)

(define-map loans
	((loan-id uint))
	((borrower principal)
	 (lender principal)
	 (amount uint)
	 (collateral uint)
	 (collateral-token principal)
	 (repayment uint)
	 (deadline uint)
	 (status uint))) ;; 0: Open, 1: Funded, 2: Repaid, 3: Liquidated

(define-map repayments
	((loan-id uint))
	((amount uint)
	 (timestamp uint)))

(define-constant ERR_UNAUTHORIZED (err u100))
(define-constant ERR_INVALID_LOAN (err u101))
(define-constant ERR_LOAN_NOT_OPEN (err u102))
(define-constant ERR_COLLATERAL_LOW (err u103))
(define-constant ERR_ALREADY_FUNDED (err u104))
(define-constant ERR_ALREADY_REPAID (err u105))
(define-constant STATUS_OPEN u0)
(define-constant STATUS_FUNDED u1)
(define-constant STATUS_REPAID u2)
(define-constant STATUS_LIQUIDATED u3)

;; Events
(define-event loan-created (loan-id uint borrower principal lender principal amount uint collateral uint deadline uint))
(define-event loan-funded (loan-id uint lender principal))
(define-event loan-repaid (loan-id uint amount uint))
(define-event loan-liquidated (loan-id uint liquidator principal))

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
