# Claude Code Development Methodology for Bakame Bar Management System

This document outlines the **step-by-step development methodology** to be provided to Claude Code to ensure robust, reliable, and maintainable development of the BMS.

---

## 1. General Principles

* **Context Awareness:** Claude Code should always reference the latest system requirements, architecture, and design documents before coding.
* **Documentation-first:** For each feature/module, Claude must read and understand the relevant requirements and design docs.
* **Coding Ethics:** Claude must follow strict coding ethics:

  * Do not assume unspecified requirements
  * Prioritize security, reliability, and auditability
  * Write clean, maintainable, and well-commented code
  * Reference and cite requirements/architecture when implementing

---

## 2. Layered Development Approach

Development will proceed **layer by layer**, locking each layer before moving to the next:

### 2.1 Database Layer

* Define all tables, indexes, constraints, and triggers.
* Ensure **multi-bar owner support**, append-only logs, and materialized views.
* Validate schema with **unit tests** (using test databases).
* Lock database schema only after passing all schema tests.

### 2.2 Services / Domain Layer

* Implement **business rules and workflows**.
* Ensure offline-first operations are handled.
* Implement **conflict resolution and event logging**.
* Develop **unit tests for each service function**.
* Perform **integration tests** with database layer.
* Lock services layer only after passing tests and review.

### 2.3 API Layer

* Expose **RPC or REST endpoints** for all services.
* Implement **authentication, authorization, and role-based access**.
* Validate input/output against domain models.
* Perform **integration tests** with services layer.
* Include **error handling, logging, and monitoring hooks**.
* Lock API layer only after rigorous testing and review.

### 2.4 UI Layer

* Integrate APIs into Web or Flutter front-end.
* Implement offline queue and synchronization UI.
* Develop **end-to-end tests (E2E)** simulating real workflows.
* Lock UI layer after passing all E2E tests and user acceptance testing.

---

## 3. Testing Strategy

* **TDD:** Test-driven development for all backend logic.
* **Unit Tests:** For database triggers, services, and API functions.
* **Integration Tests:** Validate interactions between database, services, and APIs.
* **End-to-End Tests:** Simulate real-world workflows including offline/online scenarios.
* **CI/CD:** Integrate strict CI pipelines with gates:

  * All tests must pass
  * Code coverage threshold (e.g., 90%+)
  * Linting and static analysis checks

---

## 4. Logging and Observability

* Comprehensive logging for all actions, including:

  * User ID, device ID, timestamp
  * Event type and payload
  * Error messages and stack traces
* Monitoring hooks for system health and failures
* Alerts for offline sync issues, payment disputes, or critical failures

---

## 5. Error Handling and System Failure

* **Graceful degradation:** Critical operations continue offline
* **Retry mechanisms:** For failed network or DB operations
* **Conflict resolution:** Event log + actor priority + review
* **Notifications:** Warn users of errors, sync issues, or conflicts

---

## 6. Feature Locking Protocol

* Each layer (DB, services, API, UI) is **locked only after full test suite passes and peer review**.
* Locked features are immutable unless a critical bug is found.
* Changes require formal review and retesting.

---

## 7. Code Review & Ethics

* Claude Code must produce **readable, maintainable code**.
* Every function/method should reference the **requirement or architecture it implements**.
* No hardcoding values; all configuration must be in settings or environment variables.
* Security-first mindset: validate inputs, escape outputs, encrypt sensitive data.

---

## 8. Offline-First & Sync Requirements

* All critical operations (sales, stock allocation, shift open/close, payments) must **queue locally if offline**.
* Sync retries automatically when connectivity returns.
* Conflicts flagged for manager review.

---

## 9. Multi-bar & Affiliate Considerations

* Multi-bar owners: aggregate reports and operations correctly per TIN or per bar.
* Affiliate system: separate schema, restricted access, commission tracking.

---

## 10. Development Workflow

1. Read requirements + architecture docs.
2. Implement database schema with unit tests.
3. Develop services/domain layer with TDD.
4. Build APIs with integration tests.
5. Lock backend layers after tests.
6. Implement front-end, integrate APIs.
7. Conduct E2E tests.
8. Deploy CI/CD pipeline with monitoring.
9. Iteratively review and enhance features.

---

**End of Claude Code Development Methodology for BMS**
